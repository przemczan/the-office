import type { Task } from "@the-office/contracts";
import { isArchived } from "../../shell/work/work-words.ts";

/** The archived Tasks, the newest archived first, as the Archived tab lists them. */
export function archivedTasks(tasks: readonly Task[]): Task[] {
  return tasks
    .filter(isArchived)
    .toSorted((first, second) => (second.archivedAt ?? "").localeCompare(first.archivedAt ?? ""));
}
