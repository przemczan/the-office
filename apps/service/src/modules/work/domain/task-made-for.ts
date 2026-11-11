import type { Author } from "./author.js";
import type { Task, TaskMadeFor } from "./task.js";
import { createTask, type TaskChange } from "./task-changes.js";
import { TaskCreated } from "./task-events.js";

/** What The Office sets on a Task it makes for a Project besides its Project. */
export interface MadeTaskSetting {
  readonly order: string;
  readonly createdBy: Author;
}

/** The Task The Office writes, Plan and Definition of Done included. */
export interface MadeTaskWords {
  readonly madeFor: TaskMadeFor;
  readonly title: string;
  readonly pipelineId: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
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
    { title: words.title, projectId, priority: "normal" },
    {
      order: setting.order,
      originIdeaId: undefined,
      initiativeId: undefined,
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
    filesToChange: [],
    estimatedTokens: undefined,
    definitionOfDone: words.definitionOfDone,
    definitionOfDoneConfirmed: true,
    madeFor: words.madeFor,
  };
  return {
    task: madeTask,
    event: new TaskCreated(madeTask),
    stateChange: { from: undefined, to: "ready", at: createdAt, by: setting.createdBy },
  };
}
