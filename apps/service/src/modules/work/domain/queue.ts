import type { Author } from "./author.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import type { TaskStarted } from "./task-events.js";
import type { EngineUsage } from "./usage-estimate.js";
import { TaskQueued } from "./queue-events.js";
import { TaskRefused } from "./task-refused.js";
import { withStarted } from "./cap-waits.js";
import { standInsWithStarted } from "./stand-ins-at-start.js";
import {
  startReasons,
  startTask,
  usageOnStandIns,
  type HeldAtStart,
  type StartConditions,
} from "./task-start.js";
import { overlapsOf, overlapWords } from "./task-overlap.js";
import { STARTED_STATES } from "./task-states.js";
import { reasonsOf, shortReasonsOf, type Wait } from "./wait.js";

/**
 * A Ready Task in the one Office-wide queue (spec §2.1, "A queue for Start"): only waits kept Start
 * from running it, so it waits, holding no desk, until it starts by itself. Its blockers aren't
 * kept here: each release reads them from the Task, so a dependency changed meanwhile counts.
 */
export interface QueuedTask {
  readonly taskId: string;
  /** Orders the queue, lowest first; Move up swaps it with the one ahead. */
  readonly place: number;
  readonly queuedAt: Date;
  /** Who asked for the Start that queued it, whom the start its turn makes names. */
  readonly queuedBy: Author;
  /** The waits that held it at its last turn, in full, as the Task page and Now show them. */
  readonly reasons: readonly string[];
  /** The short reason of each of `reasons`, in the same order, as the board card shows them. */
  readonly shortReasons: readonly string[];
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
 * its place, and the Tasks it is behind unless queued behind others now. `by` asked for the Start.
 */
export function startOrQueue(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
  queue: readonly QueuedTask[],
  {
    now,
    onOverlap,
    by,
  }: { readonly now: Date; readonly onOverlap: OverlapChoice; readonly by: Author },
): Starting {
  const { refusals, waits } = startReasons(task, conditions, held);
  if (refusals.length > 0) throw new TaskRefused([...refusals, ...reasonsOf(waits)]);
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
    return { kind: "started", change: startTask(task, conditions, held, by) };
  if (queued) return { kind: "queued", queued: { ...queued, ...heldBy(allWaits), behind } };
  const joined = {
    taskId: task.id,
    place: lastPlace(queue) + 1,
    queuedAt: now,
    queuedBy: by,
    ...heldBy(allWaits),
    behind,
  };
  return { kind: "queued", queued: joined, event: new TaskQueued(task.id, reasonsOf(allWaits)) };
}

/** A queued Task's reasons and short reasons, from the waits that hold it. */
function heldBy(waits: readonly Wait[]): Pick<QueuedTask, "reasons" | "shortReasons"> {
  return { reasons: reasonsOf(waits), shortReasons: shortReasonsOf(waits) };
}

/**
 * What holds a Task queued behind others: each of them not yet Done or Dropped, which `tasks`
 * holds as started (a Task it is behind that isn't there has ended or left).
 */
function behindWaits(behind: readonly string[], tasks: readonly Task[]): Wait[] {
  return tasks
    .filter(({ id, state }) => behind.includes(id) && STARTED_STATES.includes(state))
    .map(({ title }) => ({
      reason: `Queued behind "${title}" until it is Done or Dropped.`,
      short: `Behind "${title}"`,
    }));
}

/** The queue in its order, first place first. */
export function queueOrder(queue: readonly QueuedTask[]): QueuedTask[] {
  return queue.toSorted((one, other) => one.place - other.place);
}

/** What one release did to each Task it weighed, in the queue's order. */
export interface Release {
  readonly started: readonly TaskChange<TaskStarted>[];
  /** What each started Task is expected to use, by its id, on the engines it started on. */
  readonly startedEstimates: ReadonlyMap<string, readonly EngineUsage[]>;
  /** Tasks whose turn met a reason that refuses Start, with every such reason. */
  readonly refused: readonly { readonly taskId: string; readonly refusals: readonly string[] }[];
  /** Tasks still waiting, with the waits that hold them now. */
  readonly waiting: readonly QueuedTask[];
  /** The ids of those held by other reasons (or short reasons) than at their last turn. */
  readonly reasonsChanged: readonly string[];
  /** When each cap holding a waiting Task resets, or a Stand-in Engine that could take it frees. */
  readonly capResets: readonly Date[];
}

/**
 * Starts every queued Task that can start now, in the queue's order, each counting against the
 * limits of those after it and its estimate, on the engines it starts on, against their caps
 * (`withStarted`, `standInsWithStarted`), so a Task waiting for a busy person holds none behind it.
 * A Task that meets a refusal leaves the queue; one with no conditions (queued after they were
 * read) waits on.
 * `tasks` holds every Task, `fireAlarmOn` the alarm and `pausedInitiativeIds` the Initiatives
 * paused, all read in the hold of Starts.
 */
export function releaseQueue(
  queue: readonly QueuedTask[],
  {
    tasks,
    fireAlarmOn,
    pausedInitiativeIds,
  }: {
    readonly tasks: readonly Task[];
    readonly fireAlarmOn: boolean;
    readonly pausedInitiativeIds: ReadonlySet<string>;
  },
  conditionsOf: (taskId: string) => StartConditions | undefined,
): Release {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const startedTasks = tasks.filter(({ state }) => STARTED_STATES.includes(state));
  const started: TaskChange<TaskStarted>[] = [];
  const refused: { taskId: string; refusals: readonly string[] }[] = [];
  const waiting: QueuedTask[] = [];
  const reasonsChanged: string[] = [];
  const capResets: Date[] = [];
  const startedEstimates = new Map<string, readonly EngineUsage[]>();
  for (const queued of queueOrder(queue)) {
    const task = byId.get(queued.taskId);
    const read = conditionsOf(queued.taskId);
    if (!task || !read) {
      waiting.push(queued);
      continue;
    }
    const conditions = {
      ...read,
      usage: [...startedEstimates.values()].reduce(withStarted, read.usage),
      standIns: [...startedEstimates.values()].reduce(standInsWithStarted, read.standIns),
    };
    const blockers = task.blockedBy.flatMap((id) => byId.get(id) ?? []);
    const held = {
      startedTasks: [...startedTasks, ...started.map((change) => change.task)],
      blockers,
      fireAlarmOn,
      initiativePaused:
        task.initiativeId !== undefined && pausedInitiativeIds.has(task.initiativeId),
    };
    const { refusals, waits } = startReasons(task, conditions, held);
    const allWaits = [...waits, ...behindWaits(queued.behind, tasks)];
    if (refusals.length > 0) refused.push({ taskId: task.id, refusals });
    else if (allWaits.length > 0) {
      const stillQueued = { ...queued, ...heldBy(allWaits) };
      waiting.push(stillQueued);
      if (!sameReasons(queued, stillQueued)) reasonsChanged.push(task.id);
      capResets.push(...usageOnStandIns(conditions).resets);
    } else {
      started.push(startTask(task, conditions, held, { kind: "queue", queuedBy: queued.queuedBy }));
      startedEstimates.set(task.id, usageOnStandIns(conditions).usage.estimate);
    }
  }
  return { started, startedEstimates, refused, waiting, reasonsChanged, capResets };
}

/** Whether both hold the same reasons and short reasons; a Task queued before short reasons has none. */
function sameReasons(one: QueuedTask, other: QueuedTask): boolean {
  return sameWords(one.reasons, other.reasons) && sameWords(one.shortReasons, other.shortReasons);
}

function sameWords(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((words, at) => words === other[at]);
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

/**
 * Move to top: the Task takes a place ahead of the first one, so no other Task's place changes.
 * Places are only ever sorted, so one below 1 is fine. Refuses as Move up does.
 */
export function moveToTopOfQueue(queue: readonly QueuedTask[], taskId: string): QueuedTask[] {
  const ordered = queueOrder(queue);
  const moved = ordered.find((queued) => queued.taskId === taskId);
  if (!moved) throw new TaskRefused(["The Task isn't in the queue."]);
  const first = ordered[0]!;
  if (first.taskId === taskId) throw new TaskRefused(["The Task is already first in the queue."]);
  return [{ ...moved, place: first.place - 1 }];
}

function lastPlace(queue: readonly QueuedTask[]): number {
  return Math.max(0, ...queue.map(({ place }) => place));
}
