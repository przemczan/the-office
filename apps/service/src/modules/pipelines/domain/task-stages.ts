import { stageProblems, problemOnStage, type Pipeline, type StageProblem } from "./pipeline.js";
import type { Stage } from "./stage.js";
import type { StageRun } from "./stage-run.js";
import { staffingProblems, type RoleFilling } from "./stage-staffing.js";
import { TaskStagesEdited, TaskStagesMade } from "./task-stages-events.js";

/**
 * A Task's own copy of its Pipeline's Stages (spec §2.3), made as the Task starts or as the user
 * first edits them for the Task: saving the library Pipeline no longer changes them, and the
 * interpreter runs these.
 */
export interface TaskStages {
  readonly taskId: string;
  /** The library Pipeline they were copied from. */
  readonly pipelineId: string;
  readonly stages: readonly Stage[];
  readonly madeAt: Date;
  /** Set once the user edited them for the Task, which the Task's Pipeline label says. */
  readonly editedForTask: boolean;
  /** The trace every walk of the Task's Stages joins, once the first walk began it. */
  readonly trace: TaskTrace | undefined;
}

/** The first span of a Task's trace, as telemetry names it. */
export interface TaskTrace {
  readonly traceId: string;
  readonly spanId: string;
}

/** The Task's own copy of its Pipeline's Stages, with the event that announces it. */
export function makeTaskStages(
  taskId: string,
  pipeline: Pipeline,
  madeAt: Date,
): { readonly taskStages: TaskStages; readonly event: TaskStagesMade } {
  const taskStages: TaskStages = {
    taskId,
    pipelineId: pipeline.id,
    stages: pipeline.stages,
    madeAt,
    editedForTask: false,
    trace: undefined,
  };
  return { taskStages, event: new TaskStagesMade(taskId, pipeline.id) };
}

/**
 * Whether the copy is of the Pipeline the Task has now. A copy edited before Start is left behind
 * when the user swaps the Pipeline: the Task follows the library again.
 */
export function followsPipeline(own: TaskStages, pipelineId: string): boolean {
  return own.pipelineId === pipelineId;
}

/**
 * How many Stages, from the first, have started and are locked: every Stage up to the furthest
 * one with a run, since a loop or a send-back leaves runs on Stages before it.
 */
export function lockedStageCount(stages: readonly Stage[], runs: readonly StageRun[]): number {
  const ran = new Set(runs.map(({ stageKey }) => stageKey));
  return stages.findLastIndex(({ key }) => ran.has(key)) + 1;
}

/**
 * Every reason the edited Stages can't replace the Task's own, so the editor flags them all at
 * once; empty when they can.
 */
export function editProblems(
  own: TaskStages,
  edited: readonly Stage[],
  runs: readonly StageRun[],
  roles: ReadonlyMap<string, RoleFilling>,
): StageProblem[] {
  const locked = lockedStageCount(own.stages, runs);
  return [
    ...lockedStageProblems(own.stages, edited, locked),
    ...stageProblems(edited),
    ...staffingProblems(edited, locked, roles),
  ];
}

/** The Task's own Stages replaced by the user's edit, which `editProblems` allowed. */
export function editTaskStages(
  own: TaskStages,
  edited: readonly Stage[],
): { readonly taskStages: TaskStages; readonly event: TaskStagesEdited } {
  return {
    taskStages: { ...own, stages: edited, editedForTask: true },
    event: new TaskStagesEdited(own.taskId, own.pipelineId),
  };
}

function lockedStageProblems(
  stages: readonly Stage[],
  edited: readonly Stage[],
  locked: number,
): StageProblem[] {
  return stages.slice(0, locked).flatMap((stage, stageIndex) => {
    const kept = edited[stageIndex];
    return kept && sameStage(stage, kept)
      ? []
      : [problemOnStage(stage, stageIndex, "it has started, so it stays as it is, where it is.")];
  });
}

function sameStage(stage: Stage, other: Stage): boolean {
  return comparable(stage) === comparable(other);
}

/** The Stage as JSON with its keys sorted and absent fields left out, wherever it was read from. */
function comparable(stage: Stage): string {
  return JSON.stringify(stage, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
        )
      : value,
  );
}
