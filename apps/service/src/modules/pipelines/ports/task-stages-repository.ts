import type { TaskStages, TaskTrace } from "../domain/task-stages.js";

/** Where each started Task's own Stages are kept. */
export abstract class TaskStagesRepository {
  /** Saves them unless the Task already has its own Stages; true when they were saved. */
  abstract saveNew(taskStages: TaskStages): Promise<boolean>;

  abstract find(taskId: string): Promise<TaskStages | undefined>;

  /** Saves the trace the Task's walks join. */
  abstract saveTrace(taskId: string, trace: TaskTrace): Promise<void>;
}
