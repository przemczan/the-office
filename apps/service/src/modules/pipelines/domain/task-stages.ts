import { asFlow, pipelineOrder } from "./flow.js";
import { stageProblems, problemOnStage, type Pipeline, type StageProblem } from "./pipeline.js";
import {
  agentStageWorkers,
  mergedWorkers,
  NO_STAGE_WORKERS,
  type Stage,
  type StageWorkers,
} from "./stage.js";
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
 * when the user swaps the Pipeline: the Task follows the library again. A Task with no Pipeline
 * (`pipelineId` undefined) follows none.
 */
export function followsPipeline(own: TaskStages, pipelineId: string | undefined): boolean {
  return own.pipelineId === pipelineId;
}

/** States in which a Task keeps the Stages it has: its work is over. */
const FINISHED_STATES: readonly string[] = ["done", "dropped"];

export function isFinished(taskState: string): boolean {
  return FINISHED_STATES.includes(taskState);
}

/** Why a Task in this state can't have its Stages edited; undefined while it can. */
export function whyStagesAreKept(taskState: string): string | undefined {
  if (isFinished(taskState)) return "A Task that is done or dropped keeps its Stages.";
  if (taskState === "shaping") {
    return "A Task in Shaping keeps its Stages as they are: confirm its Initiative first.";
  }
  return undefined;
}

/** What of a Task tells whether its own Stages are open, and where their sessions run. */
export interface TaskOfStages {
  readonly id: string;
  readonly state: string;
  readonly projectId: string;
  readonly pipelineId: string | undefined;
}

/**
 * The Roles open Tasks' own Stages name in Agent Stages, by Project: only Stages a Task follows,
 * of a Task neither done nor dropped, still run.
 */
export function rolesNamedByOpenTasks(
  taskStages: readonly TaskStages[],
  tasks: readonly TaskOfStages[],
): ReadonlyMap<string, StageWorkers> {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const byProject = new Map<string, StageWorkers>();
  for (const own of taskStages) {
    const task = tasksById.get(own.taskId);
    if (!task || isFinished(task.state) || !followsPipeline(own, task.pipelineId)) continue;
    byProject.set(
      task.projectId,
      mergedWorkers(
        byProject.get(task.projectId) ?? NO_STAGE_WORKERS,
        agentStageWorkers(own.stages),
      ),
    );
  }
  return byProject;
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
 * Where the Task's Stages next need people: the Stage its last run left unfinished, which runs
 * again once the Task goes on, or else the first one that hasn't run.
 */
export function firstStageToWork(stages: readonly Stage[], runs: readonly StageRun[]): number {
  const last = runs.at(-1);
  const lastIndex = last ? stages.findIndex(({ key }) => key === last.stageKey) : -1;
  if (last && last.outcome?.status !== "done" && lastIndex >= 0) return lastIndex;
  return lockedStageCount(stages, runs);
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
  const ordered = pipelineOrder(asFlow(edited));
  return [
    ...lockedStageProblems(own.stages, ordered, locked),
    ...stageProblems(ordered),
    ...staffingProblems(ordered, locked, roles),
  ];
}

/** The Task's own Stages replaced by the user's edit, which `editProblems` allowed. */
export function editTaskStages(
  own: TaskStages,
  edited: readonly Stage[],
): { readonly taskStages: TaskStages; readonly event: TaskStagesEdited } {
  return {
    taskStages: { ...own, stages: pipelineOrder(asFlow(edited)), editedForTask: true },
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

/**
 * The Stage as JSON with its keys sorted and absent fields left out, wherever it was read from. Its
 * routes and place are left out: the list editor redraws a straight line's routes when a Stage is
 * inserted after a started one, and the walk doesn't follow routes yet.
 */
function comparable({ routes: _routes, place: _place, ...stage }: Stage): string {
  return JSON.stringify(stage, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
        )
      : value,
  );
}
