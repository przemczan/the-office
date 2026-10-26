import { readdir, readFile } from "node:fs/promises";

/** A process as Linux's /proc/<id>/stat tells it. */
export interface LinuxProcess {
  readonly processId: number;
  /** One letter: R running, S sleeping, Z zombie, X dead, and so on (proc(5)). */
  readonly state: string;
  readonly groupId: number;
}

/**
 * Whether a process in this state has ended: a zombie has exited and only waits for its parent,
 * or for init once it is orphaned, to collect its exit status.
 */
export function hasEnded(state: string): boolean {
  return state === "Z" || state === "X";
}

/**
 * The process a /proc/<id>/stat line describes. Its name is in parentheses and may hold spaces
 * or parentheses itself, so the fields are read after the last ")".
 */
export function processFromStat(processId: number, stat: string): LinuxProcess | undefined {
  const [state, , groupId] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (state === undefined || groupId === undefined) return undefined;
  return { processId, state, groupId: Number(groupId) };
}

/** The ids of the processes of the group that haven't ended. */
export async function runningInGroup(groupId: number): Promise<number[]> {
  const ids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
  const processes = await Promise.all(ids.map(readProcess));
  return processes.flatMap((found) =>
    found && found.groupId === groupId && !hasEnded(found.state) ? [found.processId] : [],
  );
}

async function readProcess(processId: number): Promise<LinuxProcess | undefined> {
  // A process may end between the listing and the read.
  const stat = await readFile(`/proc/${processId}/stat`, "utf8").catch(() => undefined);
  return stat === undefined ? undefined : processFromStat(processId, stat);
}
