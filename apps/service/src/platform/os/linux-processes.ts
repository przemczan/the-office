import { readdir, readFile } from "node:fs/promises";

/** A process as Linux's /proc/<id>/stat tells it. */
export interface LinuxProcess {
  readonly processId: number;
  /** One letter: R running, S sleeping, Z zombie, X dead, and so on (proc(5)). */
  readonly state: string;
  /** The process that started it, or init, or a subreaper once that one has ended. */
  readonly parentId: number;
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
  const [state, parentId, groupId] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (state === undefined || parentId === undefined || groupId === undefined) return undefined;
  return { processId, state, parentId: Number(parentId), groupId: Number(groupId) };
}

/** The ids of the processes of the group that haven't ended. */
export async function runningInGroup(groupId: number): Promise<number[]> {
  return (await runningProcesses())
    .filter((found) => found.groupId === groupId)
    .map(({ processId }) => processId);
}

/**
 * The processes the process started that haven't ended, and those they started in turn, found by
 * their parents: one whose parent ended before it was read is found no more.
 */
export async function runningDescendants(processId: number): Promise<LinuxProcess[]> {
  const running = await runningProcesses();
  const found: LinuxProcess[] = [];
  const parents = new Set([processId]);
  for (let added = true; added;) {
    added = false;
    for (const child of running) {
      if (parents.has(child.parentId) && !parents.has(child.processId)) {
        parents.add(child.processId);
        found.push(child);
        added = true;
      }
    }
  }
  return found;
}

/** Whether the process has ended: gone, or a zombie its parent hasn't collected yet. */
export async function hasProcessEnded(processId: number): Promise<boolean> {
  const found = await readProcess(processId);
  return found === undefined || hasEnded(found.state);
}

async function runningProcesses(): Promise<LinuxProcess[]> {
  const ids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
  const processes = await Promise.all(ids.map(readProcess));
  return processes.filter(
    (found): found is LinuxProcess => found !== undefined && !hasEnded(found.state),
  );
}

async function readProcess(processId: number): Promise<LinuxProcess | undefined> {
  // A process may end between the listing and the read.
  const stat = await readFile(`/proc/${processId}/stat`, "utf8").catch(() => undefined);
  return stat === undefined ? undefined : processFromStat(processId, stat);
}
