import type { Initiative } from "./initiative.js";
import {
  addDependencyOfItsTask,
  changeDescriptionOfItsTask,
  changeTitleOfItsTask,
  chooseInitiativePipeline,
  removeDependencyOfItsTask,
  requireShaperTaskAllowed,
  writeOutcome,
} from "./initiative-changes.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { NewTask, Priority, Task } from "./task.js";
import { newTaskBlockerProblems } from "./task-dependencies.js";
import { TaskNotFound } from "./task-not-found.js";
import { TaskRefused } from "./task-refused.js";

/**
 * A change by whoever shapes Initiatives to an Initiative (spec §2.1 Defaults): its outcome, a new
 * Task, the title, Description or a dependency of one of its Tasks, or the Initiative's Pipeline in
 * one Project (null for None). Written straight onto it while it is being shaped; once it is
 * active, a Proposal carries it, which Conversations keeps as drafted and Work applies.
 */
export type InitiativeEdit =
  | { readonly kind: "outcome"; readonly outcome: string }
  | {
      readonly kind: "add-task";
      readonly title: string;
      readonly projectId: string;
      readonly priority: Priority;
      /** Undefined when none was given, as in every Proposal from before it could have one. */
      readonly description?: string | undefined;
      /** The Tasks it waits for from the start, in any Project or Initiative. */
      readonly blockedBy: readonly string[];
      /** The Task added, once the user applied it; undefined before. */
      readonly taskId: string | undefined;
    }
  | { readonly kind: "add-dependency"; readonly taskId: string; readonly blockerId: string }
  | { readonly kind: "remove-dependency"; readonly taskId: string; readonly blockerId: string }
  | { readonly kind: "task-title"; readonly taskId: string; readonly title: string }
  | { readonly kind: "task-description"; readonly taskId: string; readonly description: string }
  | {
      readonly kind: "pipeline";
      readonly projectId: string;
      readonly pipelineId: string | null;
    };

/** The Task an `add-task` edit asks for. */
export function newTaskOf(edit: Extract<InitiativeEdit, { kind: "add-task" }>): NewTask {
  return {
    title: edit.title,
    description: edit.description,
    projectId: edit.projectId,
    priority: edit.priority,
  };
}

/** What whoever shapes Initiatives hears when a title they write is the one the Task has. */
export function sameTitleWords(task: Pick<Task, "title">): string {
  return `The title of "${task.title}" says so already.`;
}

/** What whoever shapes Initiatives hears when a Description they write is the one the Task has. */
export function sameDescriptionWords(task: Pick<Task, "title">): string {
  return `The Description of "${task.title}" says so already.`;
}

/**
 * Every reason applying the edit to the Initiative as it is now would be refused, judged as
 * applying it judges, in words whoever shapes Initiatives acts on; an edit that changes nothing is
 * refused too. `board` is every Task, and `names` those of the Project and the Pipeline a
 * `pipeline` edit names, their ids when left out. Whether that Project, or that Pipeline, is known
 * is the caller's to judge.
 */
export function initiativeEditProblems(
  initiative: Initiative,
  edit: InitiativeEdit,
  board: readonly Task[],
  names: PipelineEditNames = {},
): string[] {
  try {
    const unchanged = whatStaysAsItIs(initiative, edit, board, names);
    return unchanged === undefined ? [] : [unchanged];
  } catch (error) {
    if (error instanceof InitiativeRefused || error instanceof TaskRefused)
      return [...error.reasons];
    if (error instanceof TaskNotFound) return [error.message];
    throw error;
  }
}

/** Throws as applying the edit would; when it changes nothing, answers what stays as it is. */
function whatStaysAsItIs(
  initiative: Initiative,
  edit: InitiativeEdit,
  board: readonly Task[],
  names: PipelineEditNames,
): string | undefined {
  switch (edit.kind) {
    case "outcome":
      return writeOutcome(initiative, edit.outcome, "by-proposal")
        ? undefined
        : "The Initiative's outcome says so already.";
    case "add-task":
      requireShaperTaskAllowed(
        initiative,
        "by-proposal",
        newTaskOf(edit),
        newTaskBlockerProblems(edit.blockedBy, board),
      );
      return undefined;
    case "add-dependency": {
      const task = taskOn(board, edit.taskId);
      return addDependencyOfItsTask(initiative, "by-proposal", task, edit.blockerId, board)
        ? undefined
        : `"${task.title}" waits for the Task ${edit.blockerId} already.`;
    }
    case "remove-dependency": {
      const task = taskOn(board, edit.taskId);
      return removeDependencyOfItsTask(initiative, "by-proposal", task, edit.blockerId)
        ? undefined
        : `"${task.title}" doesn't wait for the Task ${edit.blockerId}.`;
    }
    case "task-title": {
      const task = taskOn(board, edit.taskId);
      return changeTitleOfItsTask(initiative, "by-proposal", task, edit.title)
        ? undefined
        : sameTitleWords(task);
    }
    case "task-description": {
      const task = taskOn(board, edit.taskId);
      return changeDescriptionOfItsTask(initiative, "by-proposal", task, edit.description)
        ? undefined
        : sameDescriptionWords(task);
    }
    case "pipeline": {
      const project = { id: edit.projectId, name: names.project ?? edit.projectId };
      // Judged only, so no Short name derived here is kept, and no taken ones are needed.
      return chooseInitiativePipeline(
        initiative,
        project,
        edit.pipelineId ?? undefined,
        "by-proposal",
        new Set(),
      )
        ? undefined
        : `The Initiative follows ${names.pipeline ?? edit.pipelineId ?? "None"} in ${project.name} already.`;
    }
  }
}

/** The names a `pipeline` edit's words use for its Project and Pipeline. */
export interface PipelineEditNames {
  readonly project?: string;
  readonly pipeline?: string;
}

function taskOn(board: readonly Task[], taskId: string): Task {
  const task = board.find(({ id }) => id === taskId);
  if (!task) throw new TaskNotFound(taskId);
  return task;
}
