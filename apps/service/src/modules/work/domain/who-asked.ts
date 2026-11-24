import type { PromptTexts } from "../../prompt-templates/index.js";
import { authorWords } from "./author.js";
import type { InitiativePlanningThread } from "./initiative.js";
import { renderedText } from "./rendered-text.js";
import { stateChangeCauseWords, type StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { TASK_WHO_ASKED } from "./work-prompt-templates.js";

/*
 * Who asked for the work a session is briefed on (spec 2.5): a Brief names the user, or whoever
 * else, in the words the record has for them.
 */

/**
 * The move a Brief names who asked for: the Task's last move to Planning, for the Planner, or its
 * last start (Ready → In progress), for an Agent Stage.
 */
export type AskedMove = "planning" | "start";

function isTheMove(move: AskedMove, { from, to }: StateChange): boolean {
  return move === "planning" ? to === "planning" : from === "ready" && to === "in-progress";
}

/** Who created the Task and who made its last `move`, as a Brief names them. */
export interface TaskWhoAsked {
  readonly createdBy: string;
  /** Empty when the move was kept from before state changes were, or never made. */
  readonly movedBy: string;
}

/** Who created the Task and who made its last `move`, from its kept state changes. */
export function taskWhoAsked(
  task: Pick<Task, "createdBy">,
  stateChanges: readonly StateChange[],
  move: AskedMove,
): TaskWhoAsked {
  const last = stateChanges.findLast((change) => isTheMove(move, change));
  return {
    createdBy: authorWords(task.createdBy),
    movedBy: last ? stateChangeCauseWords(last.by) : "",
  };
}

/**
 * The Agent Stage's Who asked: "The Task was created by the user Ann Lee and started by the queue,
 * as its turn came (queued by the user Ben Ito)."
 */
export function taskWhoAskedSection(
  prompts: PromptTexts,
  task: Pick<Task, "createdBy">,
  stateChanges: readonly StateChange[],
): string {
  const { createdBy, movedBy } = taskWhoAsked(task, stateChanges, "start");
  return renderedText(prompts, TASK_WHO_ASKED, { createdBy, startedBy: movedBy });
}

/** Who opened one of an Initiative's planning Threads; empty when that wasn't kept. */
export function initiativePlanningOpenedBy({ by }: InitiativePlanningThread): string {
  return by ? authorWords(by) : "";
}
