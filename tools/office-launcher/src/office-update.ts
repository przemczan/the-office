// An Office update of a checkout, as the launcher runs it between two runs of the service
// (docs/running-the-office.md).
import { spawn } from "node:child_process";
import { UpdateLog, writeResult, type UpdateResult, type UpdateStep } from "./update-folder.ts";

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

/**
 * Fast-forwards the checkout to `target`, installs and builds, and on a failure goes back to the
 * commit it started from and builds that again. Either way `result.json` tells the next run of the
 * service how it went, and `log.txt` holds every step's output.
 */
export async function runOfficeUpdate(
  options: OfficeUpdateOptions,
  target: string,
): Promise<UpdateResult> {
  const log = new UpdateLog(options.updateFolder);
  try {
    const result = await update(options, target, log);
    writeResult(options.updateFolder, result);
    return result;
  } finally {
    log.close();
  }
}

async function update(
  { repository, commands }: OfficeUpdateOptions,
  target: string,
  log: UpdateLog,
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
function runLogged(
  step: string,
  [program, ...args]: Command,
  cwd: string,
  log: UpdateLog,
): Promise<boolean> {
  log.step(step, [program, ...args].join(" "));
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", log.fd, log.fd] });
    child.on("error", (error) => {
      log.write(error.message);
      resolve(false);
    });
    child.on("exit", (code, signal) => {
      log.write(`== ${step} ended with ${signal ?? `exit code ${code}`}`);
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
