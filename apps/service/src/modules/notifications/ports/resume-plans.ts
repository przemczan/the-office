import type { TaskResume } from "../domain/now.js";

/**
 * How a Task the fire alarm paused would go on at the all clear, which Pipelines works out through
 * the Context policy; the composition root binds it.
 */
export abstract class ResumePlans {
  /** Undefined while the Stage the alarm holds is still stopping. */
  abstract of(taskId: string): Promise<TaskResume | undefined>;
}
