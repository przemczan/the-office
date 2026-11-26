import { asFlow, type FlowStage } from "./flow.js";
import {
  stageProblems,
  problemOnStage,
  type Pipeline,
  type StageProblem,
  type StageProblemAt,
} from "./pipeline.js";
import { unnamedRoutes, type Route, type StagePosition } from "./route.js";
import {
  agentStageWorkers,
  mergedWorkers,
  NO_STAGE_WORKERS,
  type Stage,
  type StageWorkers,
} from "./stage.js";
import type { StageRun } from "./stage-run.js";
import { staffingProblems, type RoleFilling } from "./stage-staffing.js";
import { unlinked } from "./stage-template-link.js";
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
  /** Where End stands on the canvas; undefined, right of the right-most Stage. */
  readonly endPosition?: StagePosition;
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
    stages: asFlow(unlinked(pipeline.stages)),
    ...(pipeline.endPosition && { endPosition: pipeline.endPosition }),
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
 * The keys of the Stages that have started (spec §2.3): every Stage with a run of the Task's, ended
 * or not, held, interrupted or skipped.
 */
export function startedStageKeys(runs: readonly StageRun[]): ReadonlySet<string> {
  return new Set(runs.map(({ stageKey }) => stageKey));
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
  const started = startedStageKeys(runs);
  const ordered = asFlow(edited);
  return [
    ...lockedStageProblems(asFlow(own.stages), ordered, started),
    ...stageProblems(ordered),
    ...staffingProblems(ordered, started, roles),
  ];
}

/**
 * The Task's own Stages replaced by the user's edit, which `editProblems` allowed, End standing
 * where the edit puts it.
 */
export function editTaskStages(
  own: TaskStages,
  edited: readonly Stage[],
  endPosition: StagePosition | undefined,
): { readonly taskStages: TaskStages; readonly event: TaskStagesEdited } {
  const { endPosition: _endPosition, ...kept } = own;
  return {
    taskStages: {
      ...kept,
      stages: asFlow(unlinked(edited)),
      ...(endPosition && { endPosition }),
      editedForTask: true,
    },
    event: new TaskStagesEdited(own.taskId, own.pipelineId),
  };
}

/**
 * Started Stages, and the routes out of them, are locked (spec §2.3): each started Stage must still
 * be there, by its key, with the same fields and routes out, and the Pipeline's order up to the last
 * started Stage stays as it is, so no Stage is added among them or moved into them, and a started
 * one isn't moved; a Stage among them that hasn't started may still be removed. Routes into a
 * started Stage aren't locked, and neither is any Stage's position, which is layout alone.
 */
function lockedStageProblems(
  stages: readonly FlowStage[],
  edited: readonly FlowStage[],
  started: ReadonlySet<string>,
): StageProblem[] {
  const editedKeys = new Set(edited.map(({ key }) => key));
  const frozen = stages
    .slice(0, stages.findLastIndex(({ key }) => started.has(key)) + 1)
    .filter(({ key }) => editedKeys.has(key) || started.has(key));
  const keptOrder = frozen.filter(({ key }) => editedKeys.has(key)).map(({ key }) => key);
  const startedProblems = frozen
    .filter(({ key }) => started.has(key))
    .flatMap((stage) => {
      const stageIndex = edited.findIndex(({ key }) => key === stage.key);
      const kept = edited[stageIndex];
      if (!kept) {
        const ownIndex = stages.indexOf(stage);
        return [problemOnStage(stage, ownIndex, "it has started, so it can't be removed.")];
      }
      const routesAt = changedRoutesAt(stage.routes, kept.routes);
      return [
        ...(comparable(stage) === comparable(kept)
          ? []
          : [problemOnStage(kept, stageIndex, "it has started, so it stays as it is.")]),
        ...(routesAt ? [problemOnStage(kept, stageIndex, ROUTES_OUT_LOCKED, routesAt)] : []),
        ...(keptOrder[stageIndex] === stage.key
          ? []
          : [
              problemOnStage(
                kept,
                stageIndex,
                "it has started, so it keeps its place in the order.",
              ),
            ]),
      ];
    });
  const lastStarted = frozen.at(-1);
  if (!lastStarted) return startedProblems;
  // A Stage that hasn't started, put in the frozen order where another stood.
  const movedIn = edited
    .slice(0, keptOrder.length)
    .flatMap((stage, index) =>
      started.has(stage.key) || keptOrder[index] === stage.key
        ? []
        : [
            problemOnStage(
              stage,
              index,
              `the Pipeline's order up to ${lastStarted.name.trim() || lastStarted.key}, which has started, stays as it is.`,
            ),
          ],
    );
  return [...startedProblems, ...movedIn];
}

const ROUTES_OUT_LOCKED =
  "it has started, so its routes out stay as they are. To change where the walk goes, change the routes of a Stage that hasn't started.";

/**
 * Where the routes out changed: on the first route that differs in where it leads, its condition
 * or its limit, on the Stage when one was added or removed; undefined when they are the same. The
 * Stages' names in routes are for their words alone and don't count. A kept on-failure setting was
 * read as its failure route back on both sides (`asFlow`), so it is weighed as that route.
 */
function changedRoutesAt(
  routes: readonly Route[],
  edited: readonly Route[],
): StageProblemAt | undefined {
  if (routes.length !== edited.length) return { kind: "stage" };
  const [one, other] = [unnamedRoutes(routes), unnamedRoutes(edited)];
  const routeIndex = one.findIndex((route, index) => sorted(route) !== sorted(other[index]));
  return routeIndex < 0 ? undefined : { kind: "route", routeIndex };
}

/**
 * The Stage's own fields as `sorted` JSON, wherever it was read from. Its routes are weighed apart
 * (`changedRoutesAt`), giving their own problem; where it stands on the canvas never counts.
 */
function comparable({
  routes: _routes,
  position: _position,
  place: _place,
  templateId: _templateId,
  ...stage
}: Stage): string {
  return sorted(stage);
}

/** `value` as JSON with its objects' keys sorted and absent fields left out. */
function sorted(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field !== null && typeof field === "object" && !Array.isArray(field)
      ? Object.fromEntries(
          Object.entries(field).toSorted(([one], [other]) => one.localeCompare(other)),
        )
      : field,
  );
}
