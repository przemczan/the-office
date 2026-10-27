import type { StageOfTask } from "../domain/now.js";

/** Where each started Task's own Stages stand, which Pipelines keeps; the composition root binds it. */
export abstract class TaskStageProgress {
  /** Undefined while the Task has no Stages of its own. */
  abstract progress(
    taskId: string,
  ): Promise<{ readonly stages: readonly StageOfTask[] } | undefined>;
}
