import type { ActivityStage } from "../domain/activity.js";

/** Where each started Task's own Stages stand, which Pipelines keeps; the composition root binds it. */
export abstract class ActivityStages {
  /** Undefined while the Task has no Stages of its own. */
  abstract progress(
    taskId: string,
  ): Promise<{ readonly stages: readonly ActivityStage[] } | undefined>;
}
