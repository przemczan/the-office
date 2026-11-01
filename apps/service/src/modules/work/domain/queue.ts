import { THE_USER } from "./author.js";
import { BY_THE_QUEUE } from "./state-change.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskStarted } from "./task-events.js";
import { TaskQueued } from "./queue-events.js";
import { TaskRefused } from "./task-refused.js";
import { withStartedSinceReading } from "./cap-waits.js";
import {
  capWaitsAtStart,
  startReasons,
  startTask,
  type HeldAtStart,
  type StartConditions,
} from "./task-start.js";
import { overlapsOf, overlapWords } from "./task-overlap.js";
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
  /** The Tasks it was queued behind for an Overlap: it waits until each is Done or Dropped. */
  readonly behind: readonly string[];
}

/**
 * The user's answer to an Overlap at Start: start the Task anyway, or queue it behind the Tasks it
 * overlaps. Undefined when they gave none, which refuses Start while an Overlap stands.
 */
export type OverlapChoice = "start-anyway" | "queue-behind" | undefined;

/** What Start did: started the Task, or queued it behind the others. */
export type Starting =
  | { readonly kind: "started"; readonly change: TaskChange<TaskStarted> }
  | { readonly kind: "queued"; readonly queued: QueuedTask; readonly event?: TaskQueued };

/**
 * Start (spec §2.1): starts the Task, queues it when only waits stand in its way, or refuses with
 * every reason when any refuses. An Overlap with a started Task refuses until the user chooses to
 * start anyway or to queue behind it (spec §2.1, "Overlaps at Start"). A Task already queued keeps
 * its place, and the Tasks it is behind unless queued behind others now.
 */
export function startOrQueue(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
  queue: readonly QueuedTask[],
  { now, onOverlap }: { readonly now: Date; readonly onOverlap: OverlapChoice },
): Starting {
  const { refusals, waits } = startReasons(task, conditions, held);
  if (refusals.length > 0) throw new TaskRefused([...refusals, ...waits]);
  const overlaps = overlapsOf(task, held.startedTasks);
  if (overlaps.length > 0 && onOverlap === undefined) {
    throw new TaskRefused(overlaps.map(overlapWords));
  }
  const queued = queue.find(({ taskId }) => taskId === task.id);
  const behind =
    overlaps.length > 0 && onOverlap === "queue-behind"
      ? overlaps.map(({ taskId }) => taskId)
      : (queued?.behind ?? []);
  const allWaits = [...waits, ...behindWaits(behind, held.startedTasks)];
  if (allWaits.length === 0)
    return { kind: "started", change: startTask(task, conditions, held, THE_USER) };
  if (queued) return { kind: "queued", queued: { ...queued, reasons: allWaits, behind } };
  const joined = {
    taskId: task.id,
    place: lastPlace(queue) + 1,
    queuedAt: now,
    reasons: allWaits,
    behind,
  };
  return { kind: "queued", queued: joined, event: new TaskQueued(task.id, allWaits) };
}

/**
 * What holds a Task queued behind others: each of them not yet Done or Dropped, which `tasks`
 * holds as started (a Task it is behind that isn't there has ended or left).
 */
function behindWaits(behind: readonly string[], tasks: readonly Task[]): string[] {
  return tasks
    .filter(({ id, state }) => behind.includes(id) && STARTED_STATES.includes(state))
    .map(({ title }) => `Queued behind "${title}" until it is Done or Dropped.`);
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
  /** When the caps holding each waiting Task last reset, for those caps hold. */
  readonly capResets: readonly Date[];
}

/**
 * Starts every queued Task that can start now, in the queue's order, each counting against the
 * limits of those after it and its estimate against their windows, as started on the same reading,
 * so a Task waiting for a busy person holds none behind it. A Task that
 * meets a refusal leaves the queue; one with no conditions (queued after they were read) waits on.
 * `tasks` holds every Task and `fireAlarmOn` the alarm, both read in the hold of Starts.
 */
export function releaseQueue(
  queue: readonly QueuedTask[],
  { tasks, fireAlarmOn }: { readonly tasks: readonly Task[]; readonly fireAlarmOn: boolean },
  conditionsOf: (taskId: string) => StartConditions | undefined,
): Release {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const startedTasks = tasks.filter(({ state }) => STARTED_STATES.includes(state));
  const started: TaskChange<TaskStarted>[] = [];
  const refused: { taskId: string; refusals: readonly string[] }[] = [];
  const waiting: QueuedTask[] = [];
  const capResets: Date[] = [];
  const startedEstimates: StartConditions["usage"]["estimate"][] = [];
  for (const queued of queueOrder(queue)) {
    const task = byId.get(queued.taskId);
    const read = conditionsOf(queued.taskId);
    if (!task || !read) {
      waiting.push(queued);
      continue;
    }
    const conditions = {
      ...read,
      usage: startedEstimates.reduce(withStartedSinceReading, read.usage),
    };
    const blockers = task.blockedBy.flatMap((id) => byId.get(id) ?? []);
    const held = {
      startedTasks: [...startedTasks, ...started.map((change) => change.task)],
      blockers,
      fireAlarmOn,
    };
    const { refusals, waits } = startReasons(task, conditions, held);
    const allWaits = [...waits, ...behindWaits(queued.behind, tasks)];
    if (refusals.length > 0) refused.push({ taskId: task.id, refusals });
    else if (allWaits.length > 0) {
      waiting.push({ ...queued, reasons: allWaits });
      const { resetsAt } = capWaitsAtStart(conditions.usage);
      if (resetsAt) capResets.push(resetsAt);
    } else {
      started.push(startTask(task, conditions, held, BY_THE_QUEUE));
      startedEstimates.push(conditions.usage.estimate);
    }
  }
  return { started, refused, waiting, capResets };
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
