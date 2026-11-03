import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { constants } from "node:os";
import { runOfficeUpdate, type Command, type OfficeUpdateOptions } from "./office-update.ts";

/** The exit code the service ends with to have the launcher update it (EX_TEMPFAIL). */
export const UPDATE_EXIT_CODE = 75;

/** The variable telling the service where the launcher reads its update request. */
export const UPDATE_FOLDER_VARIABLE = "OFFICE_UPDATE_FOLDER";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface LauncherOptions extends OfficeUpdateOptions {
  /** How the service starts, from `serviceDirectory`. */
  readonly service: Command;
  readonly serviceDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
}

/**
 * Runs the service until it ends, and gives its exit code. A service ending with
 * `UPDATE_EXIT_CODE` is updated and started again; a stop signal goes on to the service, and one
 * coming during an update lets the update finish, so the checkout is left whole, but starts nothing
 * after it.
 */
export async function runLauncher(options: LauncherOptions): Promise<number> {
  let stopping = false;
  let service: ReturnType<typeof spawn> | undefined;
  const forward = (signal: NodeJS.Signals): void => {
    stopping = true;
    service?.kill(signal);
  };
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
  try {
    for (;;) {
      service = startService(options);
      const code = await exitCodeOf(service);
      service = undefined;
      if (code !== UPDATE_EXIT_CODE || stopping) return code;
      await updateOnce(options);
      if (stopping) return 0;
    }
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forward);
  }
}

function startService({ service: [program, ...args], serviceDirectory, environment, updateFolder }: LauncherOptions) {
  mkdirSync(updateFolder, { recursive: true });
  return spawn(program, args, {
    cwd: serviceDirectory,
    stdio: "inherit",
    env: { ...environment, [UPDATE_FOLDER_VARIABLE]: updateFolder },
  });
}

/** The service's exit code, or 128 plus the signal's number when a signal ended it, as a shell gives. */
function exitCodeOf(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)),
    );
  });
}

/** An update that throws, such as on a request naming no commit, is logged, and the service starts as it is. */
async function updateOnce(options: LauncherOptions): Promise<void> {
  try {
    const result = await runOfficeUpdate(options);
    if (!result) options.log("The service asked for an update, but no request was written.");
    else if (result.outcome === "updated") options.log(`Updated The Office from ${result.from} to ${result.to}.`);
    else options.log(`The Office's update to ${result.to} failed at ${result.failedStep}; back at ${result.from}.`);
  } catch (error) {
    options.log(`The Office's update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
