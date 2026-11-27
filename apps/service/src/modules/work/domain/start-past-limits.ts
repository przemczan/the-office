import { behindWaits, type QueuedTask } from "./queue.js";
import type { Task } from "./task.js";
import { limitWaits, startReasons, type HeldAtStart, type StartConditions } from "./task-start.js";
import { reasonsOf } from "./wait.js";

/*
 * Start now past the limits (spec §2.1, "Start now past the limits"): a Ready Task the Office-wide
 * limit or its Project limit holds may start at the user's word, without waiting for a desk and
 * without joining the queue. Whatever else holds it still refuses, the Tasks it is queued behind
 * too.
 */

/** What starting the Task now past the limits does, for the user to confirm. */
export interface StartPastLimits {
  /** Each limit it passes, short. */
  readonly passes: readonly string[];
  /** Why it can't: what holds the Task besides the limits. None when it can. */
  readonly refusals: readonly string[];
}

/**
 * Start now past the limits, or undefined when no limit holds the Task. `queued` is its place in
 * the queue, if any.
 */
export function startPastLimits(
  task: Task,
  conditions: StartConditions,
  held: HeldAtStart,
  queued: QueuedTask | undefined,
): StartPastLimits | undefined {
  if (task.state !== "ready") return undefined;
  const limits = limitWaits(task, conditions, held);
  if (limits.length === 0) return undefined;
  const { refusals, waits } = startReasons(task, conditions, held, "wait", "start-anyway");
  const behind = behindWaits(queued?.behind ?? [], held.startedTasks);
  return {
    passes: limits.map(({ short }) => short),
    refusals: [...refusals, ...reasonsOf([...waits, ...behind])],
  };
}
