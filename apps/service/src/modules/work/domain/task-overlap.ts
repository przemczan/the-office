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
}

/**
 * The Overlaps of `task` with the started Tasks among `tasks`, in their order. A Plan with no
 * files to change overlaps none.
 */
export function overlapsOf(task: Task, tasks: readonly Task[]): Overlap[] {
  return tasks.flatMap((other) => {
    if (other.id === task.id || other.projectId !== task.projectId) return [];
    if (!STARTED_STATES.includes(other.state)) return [];
    return sharesFiles(task.filesToChange, other.filesToChange)
      ? [{ taskId: other.id, title: other.title }]
      : [];
  });
}

/** What Start says of the Overlaps when the user hasn't chosen how to start. */
export function overlapWords({ title }: Overlap): string {
  return `"${title}" is in progress and expects to change some of the same files: start anyway, or queue behind it.`;
}

function sharesFiles(ours: readonly string[], theirs: readonly string[]): boolean {
  return ours.some((path) => theirs.some((other) => covers(path, other) || covers(other, path)));
}
