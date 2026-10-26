import { readFileSync } from "node:fs";
import { hasEnded, processFromStat } from "./linux-processes.js";

/**
 * Whether the process still runs. Where /proc tells (Linux), a zombie doesn't: it has exited and
 * only waits for its parent, or init, to collect it.
 */
export function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
  } catch {
    return false;
  }
  const stat = statOf(processId);
  const found = stat === undefined ? undefined : processFromStat(processId, stat);
  return found === undefined || !hasEnded(found.state);
}

function statOf(processId: number): string | undefined {
  try {
    return readFileSync(`/proc/${processId}/stat`, "utf8");
  } catch {
    return undefined;
  }
}
