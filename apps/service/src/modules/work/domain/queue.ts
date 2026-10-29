import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskStarted } from "./task-events.js";
import { TaskQueued } from "./queue-events.js";
import { TaskRefused } from "./task-refused.js";
import { startReasons, startTask, type HeldAtStart, type StartConditions } from "./task-start.js";
import { STARTED_STATES } from "./task-states.js";

/**
 * A Ready Task in the one Office-wide queue (spec §2.1, "A queue for Start"): Start couldn't run
 * it only for a limit, so it waits, holding no desk, until it starts by itself.
 */
export interface QueuedTask {
  readonly taskId: string;
  /** Orders the queue, lowest first; Move up swaps it with the one ahead. */
  readonly place: number;
  readonly queuedAt: Date;
  /** The waits that held it at its last turn, as the board and Now show them. */
  readonly reasons: readonly string[];
}

/** What Start did: started the Task, or queued it behind the others. */
export type Starting =
  | { readonly kind: "started"; readonly change: TaskChange<TaskStarted> }
  | { readonly kind: "queued"; readonly queued: QueuedTask; readonly event?: TaskQueued };

/**
 * Start (spec §2.1): starts the Task, queues it when only waits stand in its way, or refuses with
 * every reason when any refuses. A Task already queued keeps its place.
 */
export function startOrQueue(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
  queue: readonly QueuedTask[],
  now: Date,
): Starting {
  const { refusals, waits } = startReasons(task, conditions, held);
  if (refusals.length > 0) throw new TaskRefused([...refusals, ...waits]);
  if (waits.length === 0) return { kind: "started", change: startTask(task, conditions, held) };
  const queued = queue.find(({ taskId }) => taskId === task.id);
  if (queued) return { kind: "queued", queued: { ...queued, reasons: waits } };
  const joined = { taskId: task.id, place: lastPlace(queue) + 1, queuedAt: now, reasons: waits };
  return { kind: "queued", queued: joined, event: new TaskQueued(task.id, waits) };
}

/** The queue in its order, first place first. */
export function queueOrder(queue: readonly QueuedTask[]): QueuedTask[] {
  return queue.toSorted((one, other) => one.place - other.place);
}

/** What one release did to each Task it weighed, in the queue's order. */
export interface Release {
  readonly started: readonly TaskChange<TaskStarted>[];
  /** Tasks whose turn met a reason that refuses Start, with every such reason. */
  readonly refused: readonly { readonly taskId: string; readonly refusals: readonly string[] }[];
  /** Tasks still waiting, with the waits that hold them now. */
  readonly waiting: readonly QueuedTask[];
}

/**
 * Starts every queued Task that can start now, in the queue's order, each counting against the
 * limits of those after it, so a Task waiting for a busy person holds none behind it. A Task that
 * meets a refusal leaves the queue; one with no conditions (queued after they were read) waits on.
 * `tasks` holds every Task, read in the hold of Starts.
 */
export function releaseQueue(
  queue: readonly QueuedTask[],
  tasks: readonly Task[],
  conditionsOf: (taskId: string) => StartConditions | undefined,
): Release {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const startedTasks = tasks.filter(({ state }) => STARTED_STATES.includes(state));
  const started: TaskChange<TaskStarted>[] = [];
  const refused: { taskId: string; refusals: readonly string[] }[] = [];
  const waiting: QueuedTask[] = [];
  for (const queued of queueOrder(queue)) {
    const task = byId.get(queued.taskId);
    const conditions = conditionsOf(queued.taskId);
    if (!task || !conditions) {
      waiting.push(queued);
      continue;
    }
    const blockers = task.blockedBy.flatMap((id) => byId.get(id) ?? []);
    const held = {
      startedTasks: [...startedTasks, ...started.map((change) => change.task)],
      blockers,
    };
    const { refusals, waits } = startReasons(task, conditions, held);
    if (refusals.length > 0) refused.push({ taskId: task.id, refusals });
    else if (waits.length > 0) waiting.push({ ...queued, reasons: waits });
    else started.push(startTask(task, conditions, held));
  }
  return { started, refused, waiting };
}

/**
 * Move up: the Task swaps places with the one ahead of it. Refuses when it isn't queued or is
 * already first.
 */
export function moveUpInQueue(queue: readonly QueuedTask[], taskId: string): QueuedTask[] {
  const ordered = queueOrder(queue);
  const at = ordered.findIndex((queued) => queued.taskId === taskId);
  const moved = ordered[at];
  if (!moved) throw new TaskRefused(["The Task isn't in the queue."]);
  const ahead = ordered[at - 1];
  if (!ahead) throw new TaskRefused(["The Task is already first in the queue."]);
  return [
    { ...moved, place: ahead.place },
    { ...ahead, place: moved.place },
  ];
}

function lastPlace(queue: readonly QueuedTask[]): number {
  return Math.max(0, ...queue.map(({ place }) => place));
}
