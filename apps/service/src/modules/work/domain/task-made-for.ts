import type { Author } from "./author.js";
import type { StateChangeCause } from "./state-change.js";
import type { Task, TaskMadeFor } from "./task.js";
import { createTask, type TaskChange } from "./task-changes.js";
import { TaskCreated } from "./task-events.js";

/** What The Office sets on a Task it makes for a Project besides its Project. */
export interface MadeTaskSetting {
  readonly order: string;
  readonly createdBy: Author;
  /** The Initiative it is part of: a Publishing Task's; undefined for a Project's own Tasks. */
  readonly initiativeId?: string;
}

/** The Task The Office writes, Plan and Definition of Done included. */
export interface MadeTaskWords {
  readonly madeFor: TaskMadeFor;
  readonly title: string;
  /** What the user wants, as The Office words it; empty by default. */
  readonly description?: string;
  readonly pipelineId: string;
  readonly plan: string;
  /** The files and folders the Plan expects to change; none by default. */
  readonly filesToChange?: readonly string[];
  readonly definitionOfDone: readonly string[];
  /** Who its kept creation names; its creator by default. */
  readonly stateChangeCause?: StateChangeCause;
}

/**
 * A Task The Office makes for a Project: Ready on its Pipeline, its Plan and Definition of Done
 * written by The Office and confirmed, waiting for the user's Start like any Task.
 */
export function createTaskMadeFor(
  id: string,
  projectId: string,
  words: MadeTaskWords,
  setting: MadeTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  const { task } = createTask(
    id,
    {
      title: words.title,
      projectId,
      priority: "normal",
      ...(words.description === undefined ? {} : { description: words.description }),
    },
    {
      order: setting.order,
      originIdeaId: undefined,
      initiativeId: setting.initiativeId,
      createdBy: setting.createdBy,
    },
    createdAt,
  );
  const madeTask: Task = {
    ...task,
    state: "ready",
    pipelineId: words.pipelineId,
    plan: words.plan,
    planConfirmed: true,
    filesToChange: words.filesToChange ?? [],
    estimatedTokens: undefined,
    definitionOfDone: words.definitionOfDone,
    definitionOfDoneConfirmed: true,
    madeFor: words.madeFor,
  };
  return {
    task: madeTask,
    event: new TaskCreated(madeTask),
    stateChange: {
      from: undefined,
      to: "ready",
      at: createdAt,
      by: words.stateChangeCause ?? setting.createdBy,
    },
  };
}
