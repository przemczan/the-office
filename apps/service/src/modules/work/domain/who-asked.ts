import { authorWords } from "./author.js";
import type { Initiative } from "./initiative.js";
import { stateChangeCauseWords, type StateChange } from "./state-change.js";
import type { Task } from "./task.js";

/*
 * Who asked for the work a session is briefed on (spec 2.5): a Brief names the user, or whoever
 * else, in the words the record has for them.
 */

/**
 * The move a Brief names who asked for: the Task's last move to Planning, for the Planner, or its
 * last start (Ready → In progress), for an Agent Stage.
 */
export type AskedMove = "planning" | "start";

const MOVE_WORDS: Readonly<Record<AskedMove, string>> = {
  planning: "moved to Planning",
  start: "started",
};

function isTheMove(move: AskedMove, { from, to }: StateChange): boolean {
  return move === "planning" ? to === "planning" : from === "ready" && to === "in-progress";
}

/**
 * Who created the Task and who made its last `move`, from its kept state changes: "The Task was
 * created by the user Ann Lee and started by the queue, as its turn came (queued by the user Ben
 * Ito)." A move kept from before state changes were is left out.
 */
export function taskWhoAskedSection(
  task: Pick<Task, "createdBy">,
  stateChanges: readonly StateChange[],
  move: AskedMove,
): string {
  const last = stateChanges.findLast((change) => isTheMove(move, change));
  const moved = last ? ` and ${MOVE_WORDS[move]} by ${stateChangeCauseWords(last.by)}` : "";
  return `## Who asked\n\nThe Task was created by ${authorWords(task.createdBy)}${moved}.`;
}

/** Who opened the Initiative's latest planning Thread; none before that was kept. */
export function initiativePlanningWhoAskedSection(initiative: Initiative): string | undefined {
  if (!initiative.planningStartedBy) return undefined;
  return `## Who asked\n\nThis planning Thread was opened by ${authorWords(initiative.planningStartedBy)}, with Plan the Initiative.`;
}

/** Who shaped the Initiative from its Idea, or created it from none. */
export function shapingWhoAskedSection(initiative: Initiative): string {
  const how = initiative.originIdeaId === undefined ? "created" : "shaped from its Idea";
  return `## Who asked\n\nThe Initiative was ${how} by ${authorWords(initiative.createdBy)}.`;
}
