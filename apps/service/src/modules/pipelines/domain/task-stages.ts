import type { Pipeline } from "./pipeline.js";
import type { Stage } from "./stage.js";
import { TaskStagesMade } from "./task-stages-events.js";

/**
 * A Task's own Stages, copied from its Pipeline when it starts (spec §2.3): saving the library
 * Pipeline no longer changes them, and the interpreter runs these.
 */
export interface TaskStages {
  readonly taskId: string;
  /** The library Pipeline they were copied from. */
  readonly pipelineId: string;
  readonly stages: readonly Stage[];
  readonly startedAt: Date;
}

/** The Task's own copy of its Pipeline's Stages as it starts, with the event that announces it. */
export function makeTaskStages(
  taskId: string,
  pipeline: Pipeline,
  startedAt: Date,
): { readonly taskStages: TaskStages; readonly event: TaskStagesMade } {
  const taskStages: TaskStages = {
    taskId,
    pipelineId: pipeline.id,
    stages: pipeline.stages,
    startedAt,
  };
  return { taskStages, event: new TaskStagesMade(taskId, pipeline.id) };
}
