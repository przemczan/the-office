// An Office update, as the launcher runs it between two runs of the service (docs/running-the-office.md).
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A program and its arguments. */
export type Command = readonly [string, ...string[]];

export interface UpdateCommands {
  readonly install: Command;
  readonly build: Command;
}

export const NPM_COMMANDS: UpdateCommands = {
  install: ["npm", "ci", "--no-audit", "--no-fund"],
  build: ["npm", "run", "build"],
};

export interface OfficeUpdateOptions {
  /** The Office's own git checkout. */
  readonly repository: string;
  /** `<office-data>/update`, where the service asks for the update and reads how it went. */
  readonly updateFolder: string;
  readonly commands: UpdateCommands;
}

/** The steps of an update, as `result.json` names the one that failed. */
export type UpdateStep = "fetch" | "merge" | "install" | "build";

/** What `result.json` holds once an update is over; the service reads it as it starts. */
export type UpdateResult =
  | { readonly outcome: "updated"; readonly from: string; readonly to: string; readonly finishedAt: string }
  | {
      readonly outcome: "failed";
      readonly from: string;
      readonly to: string;
      readonly failedStep: UpdateStep;
      /** Set when going back to `from` failed too, so the checkout may be neither. */
      readonly rollbackFailed?: true;
      readonly finishedAt: string;
    };

export const REQUEST_FILE = "request.json";
export const RESULT_FILE = "result.json";
export const LOG_FILE = "log.txt";

/**
 * Runs the update the service asked for in `request.json`: fast-forwards the checkout to its target
 * commit, installs and builds, and on a failure goes back to the commit it started from and builds
 * that again. Either way `result.json` tells the next run of the service how it went, and `log.txt`
 * holds every step's output. Undefined when nothing was asked.
 */
export async function runOfficeUpdate(options: OfficeUpdateOptions): Promise<UpdateResult | undefined> {
  const target = takeRequest(options.updateFolder);
  if (!target) return undefined;
  const log = openSync(join(options.updateFolder, LOG_FILE), "w");
  try {
    const result = await update(options, target, log);
    writeFileSync(join(options.updateFolder, RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    closeSync(log);
  }
}

/** The target commit of the request, which is taken, so a crash mid-update never repeats it. */
function takeRequest(updateFolder: string): string | undefined {
  mkdirSync(updateFolder, { recursive: true });
  const requestPath = join(updateFolder, REQUEST_FILE);
  let text: string;
  try {
    text = readFileSync(requestPath, "utf8");
  } catch {
    return undefined;
  }
  rmSync(requestPath, { force: true });
  const { target } = JSON.parse(text) as { target?: unknown };
  if (typeof target !== "string" || !/^[0-9a-f]{40}$/.test(target)) {
    throw new Error(`${requestPath} names no commit to update to.`);
  }
  return target;
}

async function update(
  { repository, commands }: OfficeUpdateOptions,
  target: string,
  log: number,
): Promise<UpdateResult> {
  const run = (step: string, command: Command) => runLogged(step, command, repository, log);
  const from = (await output(["git", "rev-parse", "HEAD"], repository)).trim();
  const steps: readonly (readonly [UpdateStep, Command])[] = [
    ["fetch", ["git", "fetch", "--no-progress"]],
    ["merge", ["git", "merge", "--ff-only", target]],
    ["install", commands.install],
    ["build", commands.build],
  ];
  for (const [step, command] of steps) {
    if (await run(step, command)) continue;
    const rolledBack =
      (await run("rollback", ["git", "reset", "--hard", from])) &&
      (await run("rollback install", commands.install)) &&
      (await run("rollback build", commands.build));
    return {
      outcome: "failed",
      from,
      to: target,
      failedStep: step,
      ...(rolledBack ? {} : { rollbackFailed: true as const }),
      finishedAt: new Date().toISOString(),
    };
  }
  return { outcome: "updated", from, to: target, finishedAt: new Date().toISOString() };
}

/** Runs one step with its output in the log; whether it succeeded. */
function runLogged(step: string, [program, ...args]: Command, cwd: string, log: number): Promise<boolean> {
  writeFileSync(log, `\n== ${step}: ${[program, ...args].join(" ")}\n`);
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", log, log] });
    child.on("error", (error) => {
      writeFileSync(log, `${error.message}\n`);
      resolve(false);
    });
    child.on("exit", (code, signal) => {
      writeFileSync(log, `== ${step} ended with ${signal ?? `exit code ${code}`}\n`);
      resolve(code === 0);
    });
  });
}

function output([program, ...args]: Command, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(text) : reject(new Error(`${program} ${args.join(" ")} failed.`)),
    );
  });
}
