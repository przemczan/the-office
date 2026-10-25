import { generateKeyBetween } from "fractional-indexing";
import { PRIORITIES, type Priority, type Task } from "./task.js";

/**
 * The board keeps one manual order per column: by priority, then by each Task's order key.
 * The keys are fractional, so a Task moves by taking a key between its new neighbours' without
 * renumbering the others, and they compare as plain strings (code units, never a locale).
 */
export function boardOrder(a: Task, b: Task): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    compareKeys(a.order, b.order) ||
    compareKeys(a.id, b.id)
  );
}

/** The key for a Task placed after every other, given the greatest key so far. */
export function orderAfter(lastOrder: string | undefined): string {
  return generateKeyBetween(lastOrder ?? null, null);
}

/** The Tasks a moved Task lands between in its column; undefined at either end. */
export interface Neighbours {
  readonly above: Task | undefined;
  readonly below: Task | undefined;
}

/**
 * Where a Task dropped between its neighbours stands: the priority nearest its own that keeps it
 * there, and a key between the neighbours of that priority.
 */
export function placementBetween(
  task: Task,
  { above, below }: Neighbours,
): Pick<Task, "priority" | "order"> {
  const highest = above ? priorityRank(above.priority) : 0;
  const lowest = below ? priorityRank(below.priority) : PRIORITIES.length - 1;
  const rank = Math.min(Math.max(priorityRank(task.priority), highest), lowest);
  const priority = PRIORITIES[rank] ?? task.priority;
  const lower = above?.priority === priority ? above.order : undefined;
  const upper = below?.priority === priority ? below.order : undefined;
  // With no neighbour of its priority, nothing else of that priority is in the column.
  if (lower === undefined && upper === undefined) return { priority, order: task.order };
  return { priority, order: generateKeyBetween(lower ?? null, upper ?? null) };
}

function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
