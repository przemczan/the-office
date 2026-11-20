import type { Author } from "./author.js";
import type { StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { withStateChange, type TaskChange } from "./task-changes.js";
import { TaskMovedToProject, TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/*
 * Move (spec §2.1, "Moving a Task"): a Task not yet planned or started goes to another Project,
 * with no Pipeline until one is chosen there, as the new Project's commands differ, back in Backlog with its Plan and Definition of Done
 * kept but Not confirmed, as they were written for the old Project; a Task in Shaping stays in
 * Shaping, for Confirm alone to move on. Its Initiative, dependencies, Attachments and Threads stay
 * with it.
 */

/**
 * Why a planning or a person's Thread that was opening as the Task moved doesn't go on: its
 * worktree was made in the old Project.
 */
export const MOVED_AS_IT_OPENED =
  "The Task moved to another Project as this was opening; open it again from the Task's page.";

/** What the Task's history and its Project tell about it, read as the Move is weighed. */
export interface MoveGrounds {
  /** Its kept state changes, oldest first. */
  readonly stateChanges: readonly StateChange[];
  /** Whether it has a worktree in its Project. */
  readonly hasWorktree: boolean;
}

/** Every reason the Task can't move to another Project; empty when it can. */
export function moveProblems(task: Task, { stateChanges, hasWorktree }: MoveGrounds): string[] {
  if (task.madeFor === "onboard") {
    return ["An Onboard Task belongs to its Project, so it can't move to another."];
  }
  if (task.madeFor === "run-environment-setup") {
    return [
      'A "Set up the run environment" Task belongs to its Project, so it can\'t move to another.',
    ];
  }
  if (task.madeFor === "publishing") {
    return ["A Publishing Task belongs to its Project, so it can't move to another."];
  }
  if (task.madeFor === "resolve-conflicts") {
    return [
      "A Conflict resolution Task works on its pull request's branch in its Project, so it can't move to another.",
    ];
  }
  const problems: string[] = [];
  // Planning is refused by the Task's history, below.
  if (!NOT_STARTED_STATES.includes(task.state)) {
    problems.push(
      `A Task can't move to another Project once it has started or ended; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    );
  }
  problems.push(...planningProblems(task, stateChanges));
  if (hasWorktree) {
    problems.push("The Task has a worktree in its Project, so it can't move to another.");
  }
  return problems;
}

/**
 * A Task that has entered Planning was planned for its Project; it may be Ready or back in Backlog
 * since (its planning Thread couldn't be opened, or a changing Save took it there before Saves on a
 * planned Task went back to Planning), so its kept history decides, not its state. A history not
 * kept from the Task's creation can't tell.
 */
function planningProblems(task: Task, stateChanges: readonly StateChange[]): string[] {
  const keptFromCreation = stateChanges[0] !== undefined && stateChanges[0].from === undefined;
  if (!keptFromCreation) {
    return [
      "The Task is older than the state changes The Office keeps, so it can't tell whether the Task was planned for its Project; it can't move to another.",
    ];
  }
  const planned = task.state === "planning" || stateChanges.some(({ to }) => to === "planning");
  return planned
    ? [
        "A Task can't move to another Project once it has entered Planning: it was planned for this one.",
      ]
    : [];
}

/**
 * Moves the Task to the Project `toProjectId`, refused with every reason it can't. Undefined when
 * it is in that Project already. A Ready Task goes back to Backlog in the same save, as a changing
 * Save takes it: Ready needs both parts confirmed, so nothing can start it in between.
 */
export function moveTask(
  task: Task,
  toProjectId: string,
  grounds: MoveGrounds,
  by: Author,
): TaskChange<TaskMovedToProject> | undefined {
  if (task.projectId === toProjectId) return undefined;
  const problems = moveProblems(task, grounds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const state = task.state === "ready" ? "backlog" : task.state;
  const leftReady =
    state === task.state ? undefined : new TaskStateChanged(task.id, task.state, state);
  const event = new TaskMovedToProject(task.id, task.projectId, toProjectId, leftReady);
  const move = { from: task.projectId, to: toProjectId, at: event.occurredAt, by };
  const moved: Task = {
    ...task,
    projectId: toProjectId,
    pipelineId: undefined,
    proposedPipeline: undefined,
    planConfirmed: false,
    definitionOfDoneConfirmed: false,
    state,
    projectMoves: [...task.projectMoves, move],
  };
  return withStateChange({ task: moved, event }, task, by);
}
