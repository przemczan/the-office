import type { QueuedTask, Task, TaskState } from "@the-office/contracts";
import { lastEndedFirst } from "./last-ended-first.ts";

export interface Column {
  readonly key: string;
  readonly label: string;
  readonly hint: (planner: string) => string;
  readonly holds: (task: Task, queue: readonly QueuedTask[]) => boolean;
  /** Its cards in order; left out, they keep the service's order (priority, then manual order). */
  readonly inOrder?: (cards: readonly Task[], queue: readonly QueuedTask[]) => Task[];
}

/** The Task's place in the queue. A Task that left Ready ignores an entry not yet read as gone. */
export function queuedEntryOf(task: Task, queue: readonly QueuedTask[]): QueuedTask | undefined {
  return task.state === "ready" ? queue.find(({ taskId }) => taskId === task.id) : undefined;
}

function inStates(...states: readonly TaskState[]): Column["holds"] {
  return (task) => states.includes(task.state);
}

function placeOf(task: Task, queue: readonly QueuedTask[]): number {
  return queuedEntryOf(task, queue)?.place ?? 0;
}

/**
 * A queued Task stays Ready (spec §2.1, "A queue for Start"): Queued only shows it apart, so Ready
 * holds what waits for the user. Waiting on you and Paused are In progress's side states; Dropped
 * ends a Task like Done.
 */
export const COLUMNS: readonly Column[] = [
  { key: "backlog", label: "Backlog", holds: inStates("backlog"), hint: () => "Not planned yet" },
  {
    key: "planning",
    label: "Planning",
    holds: inStates("planning"),
    hint: (planner) => `Plan and Definition of Done with ${planner}`,
  },
  {
    key: "ready",
    label: "Ready",
    holds: (task, queue) => task.state === "ready" && !queuedEntryOf(task, queue),
    hint: () => "Starting is your call",
  },
  {
    key: "queued",
    label: "Queued",
    holds: (task, queue) => queuedEntryOf(task, queue) !== undefined,
    inOrder: (cards, queue) =>
      cards.toSorted((first, second) => placeOf(first, queue) - placeOf(second, queue)),
    hint: () => "They start by themselves when their turn comes",
  },
  {
    key: "in-progress",
    label: "In progress",
    holds: inStates("in-progress", "waiting-on-you", "paused"),
    hint: () => "Agents work its Pipeline",
  },
  {
    key: "done",
    label: "Done",
    holds: inStates("done", "dropped"),
    inOrder: (cards) => cards.toSorted(lastEndedFirst),
    hint: () => "Done and dropped",
  },
];

/** The column's cards among `tasks`, in the order they show. */
export function cardsIn(
  column: Column,
  tasks: readonly Task[],
  queue: readonly QueuedTask[],
): Task[] {
  const cards = tasks.filter((task) => column.holds(task, queue));
  return column.inOrder?.(cards, queue) ?? cards;
}
