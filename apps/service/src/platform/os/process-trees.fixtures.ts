import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { hasEnded, processFromStat } from "./linux-processes.js";

/**
 * Whether the process still runs. Where /proc tells (Linux), a zombie doesn't: it has exited and
 * only waits for its parent, or init, to collect it.
 *
 * It knows the process by its id alone, which Windows hands to a new process as soon as about a
 * second after the old one ended: a check later than right after the end, such as one after a
 * PowerShell query, may find an unrelated process. Mark the process and use `isMarkedRunning`.
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

/** An argument, unique to the call, that a test adds to the command lines of processes it checks. */
export function processMark(): string {
  return `--test-process-mark=${randomUUID()}`;
}

/**
 * Whether the process still runs and is the one started with `mark` on its command line, never a
 * later process that took its id.
 */
export async function isMarkedRunning(processId: number, mark: string): Promise<boolean> {
  if (!isRunning(processId)) return false;
  const commandLine = await commandLineOf(processId);
  return commandLine?.includes(mark) ?? false;
}

function statOf(processId: number): string | undefined {
  try {
    return readFileSync(`/proc/${processId}/stat`, "utf8");
  } catch {
    return undefined;
  }
}

/** The process's command line, or undefined once it has gone. */
async function commandLineOf(processId: number): Promise<string | undefined> {
  if (process.platform !== "win32") {
    try {
      return readFileSync(`/proc/${processId}/cmdline`, "utf8").replaceAll("\0", " ");
    } catch {
      return undefined;
    }
  }
  const powerShell = win32.join(
    process.env["SystemRoot"] || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const query = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${processId}').CommandLine`;
  const { stdout } = await promisify(execFile)(
    powerShell,
    ["-NoProfile", "-NonInteractive", "-Command", query],
    { windowsHide: true },
  );
  return stdout.trim() || undefined;
}
