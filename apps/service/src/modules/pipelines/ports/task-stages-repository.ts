import type { TaskStages, TaskTrace } from "../domain/task-stages.js";

/** Where each Task's own Stages are kept. */
export abstract class TaskStagesRepository {
  /** Saves them in place of any the Task had. */
  abstract save(taskStages: TaskStages): Promise<void>;

  abstract find(taskId: string): Promise<TaskStages | undefined>;

  /** Saves the trace the Task's walks join. */
  abstract saveTrace(taskId: string, trace: TaskTrace): Promise<void>;

  abstract remove(taskId: string): Promise<void>;
}
