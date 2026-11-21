import { generateKeyBetween } from "fractional-indexing";
import { PRIORITIES, type Priority, type Task } from "./task.js";

/** What the board's order reads of a Task. */
type OnTheBoard = Pick<Task, "id" | "priority" | "order">;

/**
 * The board keeps one manual order per column: by priority, then by each Task's order key.
 * The keys are fractional, so a Task moves by taking a key between two others without
 * renumbering them, and they compare as plain strings (code units, never a locale). A key is
 * unique on the whole board, since a Task keeps its key when it changes column.
 */
export function boardOrder(a: OnTheBoard, b: OnTheBoard): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    compareOrders(a.order, b.order) ||
    compareOrders(a.id, b.id)
  );
}

/** The key for a Task placed after every other, given every key on the board. */
export function orderAfter(takenOrders: readonly string[]): string {
  return generateKeyBetween(takenOrders.reduce(greater, undefined) ?? null, null);
}

/** The Tasks a moved Task lands between in its column; undefined at either end. */
export interface Neighbours {
  readonly above: Task | undefined;
  readonly below: Task | undefined;
}

/**
 * Where a Task dropped between its neighbours stands: the priority nearest its own that keeps it
 * there, and a key after the neighbour above of that priority (or before the one below), with no
 * key of any column in between, so it stays unique. `takenOrders` are every other Task's keys.
 */
export function placementBetween(
  task: Task,
  { above, below }: Neighbours,
  takenOrders: readonly string[],
): Pick<Task, "priority" | "order"> {
  const highest = above ? priorityRank(above.priority) : 0;
  const lowest = below ? priorityRank(below.priority) : PRIORITIES.length - 1;
  const rank = Math.min(Math.max(priorityRank(task.priority), highest), lowest);
  const priority = PRIORITIES[rank] ?? task.priority;
  if (above?.priority === priority) {
    const next = takenOrders.filter((order) => order > above.order).reduce(smaller, undefined);
    return { priority, order: generateKeyBetween(above.order, next ?? null) };
  }
  if (below?.priority === priority) {
    const previous = takenOrders.filter((order) => order < below.order).reduce(greater, undefined);
    return { priority, order: generateKeyBetween(previous ?? null, below.order) };
  }
  // With no neighbour of its priority, nothing else of that priority is in the column.
  return { priority, order: task.order };
}

export function compareOrders(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

function greater(found: string | undefined, order: string): string {
  return found === undefined || order > found ? order : found;
}

function smaller(found: string | undefined, order: string): string {
  return found === undefined || order < found ? order : found;
}
