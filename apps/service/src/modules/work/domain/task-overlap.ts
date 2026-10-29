import { covers } from "./files-to-change.js";
import type { Task } from "./task.js";
import { STARTED_STATES } from "./task-states.js";

/**
 * An Overlap (spec §2.1, "Overlaps at Start"): a started Task in the same Project whose Plan
 * expects to change some of the files the starting Task's Plan does.
 */
export interface Overlap {
  readonly taskId: string;
  readonly title: string;
  /** The files both expect to change: of a folder and a file under it, the file. */
  readonly files: readonly string[];
}

/**
 * The Overlaps of `task` with the started Tasks among `tasks`, in their order. A Plan with no
 * files to change overlaps none.
 */
export function overlapsOf(task: Task, tasks: readonly Task[]): Overlap[] {
  return tasks.flatMap((other) => {
    if (other.id === task.id || other.projectId !== task.projectId) return [];
    if (!STARTED_STATES.includes(other.state)) return [];
    const files = sharedFiles(task.filesToChange, other.filesToChange);
    return files.length > 0 ? [{ taskId: other.id, title: other.title, files }] : [];
  });
}

/** What Start says of the Overlaps when the user hasn't chosen how to start. */
export function overlapWords({ title, files }: Overlap): string {
  return `"${title}" is in progress and expects to change ${files.join(", ")} too: start anyway, or queue behind it.`;
}

function sharedFiles(ours: readonly string[], theirs: readonly string[]): string[] {
  const shared = ours.flatMap((path) =>
    theirs.flatMap((other) => {
      if (covers(path, other)) return [other];
      if (covers(other, path)) return [path];
      return [];
    }),
  );
  return [...new Set(shared)];
}
