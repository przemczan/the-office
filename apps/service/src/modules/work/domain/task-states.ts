import type { Task, TaskState } from "./task.js";

/** Each state as the UI names it. */
export const TASK_STATE_NAMES: Readonly<Record<TaskState, string>> = {
  backlog: "Backlog",
  planning: "Planning",
  ready: "Ready",
  "in-progress": "In progress",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
};

/**
 * Where a Task may go from each state. Work only moves forward; Waiting on you and Paused are
 * side states of In progress and move among themselves; Dropped is open until the Task ends.
 */
const NEXT_STATES: Readonly<Record<TaskState, readonly TaskState[]>> = {
  backlog: ["planning", "dropped"],
  planning: ["ready", "dropped"],
  ready: ["in-progress", "dropped"],
  "in-progress": ["waiting-on-you", "paused", "done", "dropped"],
  "waiting-on-you": ["in-progress", "paused", "dropped"],
  paused: ["in-progress", "waiting-on-you", "dropped"],
  done: [],
  dropped: [],
};

/** States from which the user may still reorder a Task on the board: it hasn't started. */
export const NOT_STARTED_STATES: readonly TaskState[] = ["backlog", "planning", "ready"];

/**
 * States of a started Task: Waiting on you and Paused keep its worktree and session, so they count
 * against the Task limits as In progress does (spec §9).
 */
export const STARTED_STATES: readonly TaskState[] = ["in-progress", "waiting-on-you", "paused"];

/** Every reason the Task can't move to `to`; empty when it can or is already there. */
export function stateChangeProblems(task: Task, to: TaskState): string[] {
  if (task.state === to) return [];
  if (!NEXT_STATES[task.state].includes(to)) {
    return [`A Task in ${TASK_STATE_NAMES[task.state]} can't move to ${TASK_STATE_NAMES[to]}.`];
  }
  return to === "ready" ? readyProblems(task) : [];
}

/** One condition of Ready, as the "Before Ready" checklist names it; `problems` is empty once met. */
export interface ReadinessLine {
  readonly label: string;
  readonly problems: readonly string[];
}

/**
 * Ready requires a Plan and a Definition of Done, each confirmed by the user, no Pipeline proposal
 * left open (the user takes or declines it, keeping the Pipeline the Task follows) and no Decision
 * on the Task waiting (spec §2.1). The one list of conditions: the refusals and the checklist
 * both come from it.
 */
export function readinessLines(task: Task, openDecisions: number): ReadinessLine[] {
  return [
    { label: "Plan confirmed", problems: planProblems(task) },
    { label: "Definition of Done confirmed", problems: definitionOfDoneProblems(task) },
    {
      label: "Pipeline taken or declined",
      problems: task.proposedPipeline
        ? ["Take or decline the proposed Pipeline before the Task can be Ready."]
        : [],
    },
    { label: "No Decision waiting", problems: openDecisionProblems(openDecisions) },
  ];
}

function planProblems(task: Task): string[] {
  if (task.plan.trim() === "") return ["A Task needs a Plan before it can be Ready."];
  return task.planConfirmed ? [] : ["Confirm the Plan before the Task can be Ready."];
}

function definitionOfDoneProblems(task: Task): string[] {
  if (task.definitionOfDone.length === 0) {
    return ["A Task needs a Definition of Done before it can be Ready."];
  }
  return task.definitionOfDoneConfirmed
    ? []
    : ["Confirm the Definition of Done before the Task can be Ready."];
}

/** Every reason the Task's own record keeps it from Ready; Decisions are asked of Work's ports. */
function readyProblems(task: Task): string[] {
  return readinessLines(task, 0).flatMap(({ problems }) => problems);
}

/** Ready also waits for every Decision on the Task to be answered (spec §2.1, the user's answer). */
export function openDecisionProblems(openDecisions: number): string[] {
  if (openDecisions === 0) return [];
  return [
    openDecisions === 1
      ? "Answer the open Decision before the Task can be Ready."
      : `Answer the ${openDecisions} open Decisions before the Task can be Ready.`,
  ];
}
