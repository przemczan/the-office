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

/** Every reason the Task can't move to `to`; empty when it can or is already there. */
export function stateChangeProblems(task: Task, to: TaskState): string[] {
  if (task.state === to) return [];
  if (!NEXT_STATES[task.state].includes(to)) {
    return [`A Task in ${TASK_STATE_NAMES[task.state]} can't move to ${TASK_STATE_NAMES[to]}.`];
  }
  return to === "ready" ? readyProblems(task) : [];
}

/**
 * Ready requires a Plan and a Definition of Done, each confirmed by the user, and no Pipeline
 * proposal left open: the user uses it or keeps the Pipeline the Task follows (spec §2.1).
 */
function readyProblems(task: Task): string[] {
  const problems: string[] = [];
  if (task.plan.trim() === "") problems.push("A Task needs a Plan before it can be Ready.");
  else if (!task.planConfirmed) problems.push("Confirm the Plan before the Task can be Ready.");
  if (task.definitionOfDone.length === 0) {
    problems.push("A Task needs a Definition of Done before it can be Ready.");
  } else if (!task.definitionOfDoneConfirmed) {
    problems.push("Confirm the Definition of Done before the Task can be Ready.");
  }
  if (task.proposedPipeline) {
    problems.push(
      "Use the proposed Pipeline or keep the current one before the Task can be Ready.",
    );
  }
  return problems;
}
