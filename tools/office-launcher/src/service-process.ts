import type { ChildProcess } from "node:child_process";
import { constants } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

/** How long a service stopped by the launcher has to end before it is killed. */
const STOP_GRACE_MS = 60_000;

/** A run of the service, with its exit code once it ends, heard from its start on. */
export interface RunningService {
  readonly child: ChildProcess;
  readonly exited: Promise<number>;
}

export function runningService(child: ChildProcess): RunningService {
  return { child, exited: exitCodeOf(child) };
}

/** Stops the service with SIGTERM, then SIGKILL once its grace is over; its exit code. */
export async function stopService(
  { child, exited }: RunningService,
  graceMs = STOP_GRACE_MS,
): Promise<number> {
  child.kill("SIGTERM");
  const ended = await Promise.race([exited, delay(graceMs, undefined, { ref: false })]);
  if (ended !== undefined) return ended;
  child.kill("SIGKILL");
  return exited;
}

/** The service's exit code, or 128 plus the signal's number when a signal ended it, as a shell gives. */
function exitCodeOf(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)),
    );
  });
}
