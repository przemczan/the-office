import type { RouteLimit, StageRun, TaskStage, TaskState } from "@the-office/contracts";
import { isRouteBack, limitOf } from "../../shell/pipelines/flow/flow-model.ts";
import type { FlowProgress } from "../../shell/pipelines/flow/flow-marks.ts";

/**
 * Where a Task's walk through its Pipeline stands (docs/design/task-pipeline-progress.html): the
 * Stages in the order the walk reached them, their rounds, the Stage it is at and the routes it
 * took. The rail, the Open diagram window, the Pipeline in small and the Initiative's track all read
 * it, so they agree. Runs of an earlier start (before a Start over) are history only and count for
 * nothing here.
 */

/** The states that hold the walk at a Stage, so the walk is "at" it without a run to say so. */
const HOLDING_STATES: readonly TaskStage["state"][] = [
  "running",
  "waiting-on-you",
  "failed",
  "paused",
  "stopped",
];

/** A route the walk followed from a Stage; `to` null for End. */
export interface TakenRoute {
  readonly to: string | null;
  /** How many times the walk followed it, a resumed run not adding to it. */
  readonly times: number;
  /** How many it may, with any times the user allowed since; null for a route with No limit. */
  readonly limit: RouteLimit;
}

/** How a run was left: by its route, or by the user's Restart from…. */
export type WalkWent =
  | {
      readonly kind: "on" | "back";
      readonly to: string;
      readonly times: number;
      readonly limit: RouteLimit;
    }
  | { readonly kind: "end"; readonly times: number; readonly limit: RouteLimit }
  | { readonly kind: "restart"; readonly to: string };

/** One run of this start, in the order they ran. */
export interface WalkStep {
  readonly stageKey: string;
  readonly run: StageRun;
  /** Its place in the walk, from 1. */
  readonly number: number;
  /** Which round of its Stage it belongs to, from 1. */
  readonly round: number;
  readonly went: WalkWent | null;
}

export interface ProgressStage {
  readonly taskStage: TaskStage;
  /** Whether the walk has run it, or jumped over it by a Restart from…. */
  readonly reached: boolean;
  /** How many times the work came to it in this start: 0 before it ran. */
  readonly rounds: number;
  /** N of "Round n of ≤N"; null when nothing bounds the rounds, or n is past it. */
  readonly roundBound: number | null;
  /** Its runs of this start, as walk steps. */
  readonly steps: readonly WalkStep[];
}

export interface PipelineProgress {
  /** The rail's order: reached, with those jumped over after the Stage that left them, then the rest in Pipeline order. */
  readonly stages: readonly ProgressStage[];
  /** The Stage of the latest run of this start; null before any run, and once Done or Dropped. */
  readonly currentKey: string | null;
  /** The routes the walk followed in this start, by the Stage they leave. */
  readonly taken: ReadonlyMap<string, readonly TakenRoute[]>;
  /** Every run of this start, in order. */
  readonly walk: readonly WalkStep[];
  /** Whether any run of this start ran: before, every route is drawn as ahead. */
  readonly started: boolean;
  /** The latest Start over, with how many runs the earlier starts left; null before any. */
  readonly startedOver: StartedOver | null;
}

export interface StartedOver {
  readonly by: NonNullable<StageRun["startedOver"]>;
  readonly earlierRuns: number;
}

export function pipelineProgress(
  taskStages: readonly TaskStage[],
  taskState: TaskState,
): PipelineProgress {
  const flow = taskStages.map(({ stage }) => stage);
  const runs = taskStages
    .flatMap(({ stage, runs: own }) =>
      own.filter((run) => !run.earlierStart).map((run) => ({ key: stage.key, run })),
    )
    .toSorted((earlier, later) => earlier.run.number - later.run.number);

  const reachedKeys: string[] = [];
  const reach = (key: string): void => {
    if (!reachedKeys.includes(key)) reachedKeys.push(key);
  };
  const rounds = new Map<string, number>();
  const walk: WalkStep[] = [];
  const taken = new Map<string, TakenRoute[]>();

  runs.forEach(({ key, run }, place) => {
    const before = runs[place - 1];
    // A run resumed after a Decision or a Pause, left by no route, is the same round.
    const comesAgain = before === undefined || before.key !== key || before.run.route?.to === key;
    if (comesAgain) rounds.set(key, (rounds.get(key) ?? 0) + 1);
    reach(key);
    let went: WalkWent | null = null;
    if (run.restart) {
      skippedBetween(taskStages, key, run.restart.stageKey).forEach(reach);
      went = { kind: "restart", to: run.restart.stageKey };
    }
    const { route } = run;
    const next = runs[place + 1];
    if (route && (route.to === null || next?.key === route.to)) {
      went =
        route.to === null
          ? { kind: "end", times: route.times, limit: route.limit }
          : {
              kind: isRouteBack(flow, key, route.to) ? "back" : "on",
              to: route.to,
              times: route.times,
              limit: route.limit,
            };
      const own = (taken.get(key) ?? []).filter(({ to }) => to !== route.to);
      taken.set(key, [...own, { to: route.to, times: route.times, limit: route.limit }]);
    }
    walk.push({ stageKey: key, run, number: place + 1, round: rounds.get(key) ?? 1, went });
  });

  const rest = taskStages.map(({ stage }) => stage.key).filter((key) => !reachedKeys.includes(key));
  const stages = [...reachedKeys, ...rest].flatMap((key): ProgressStage[] => {
    const taskStage = taskStages.find(({ stage }) => stage.key === key);
    if (!taskStage) return [];
    const count = rounds.get(key) ?? 0;
    return [
      {
        taskStage,
        reached: reachedKeys.includes(key),
        rounds: count,
        roundBound: roundBound(taskStages, key, count),
        steps: walk.filter(({ stageKey }) => stageKey === key),
      },
    ];
  });
  return {
    stages,
    currentKey: currentKeyOf(taskStages, walk, taskState),
    taken,
    walk,
    started: runs.length > 0,
    startedOver: startedOverOf(taskStages),
  };
}

function startedOverOf(taskStages: readonly TaskStage[]): StartedOver | null {
  const earlier = taskStages
    .flatMap(({ runs }) => runs.filter(({ earlierStart }) => earlierStart))
    .toSorted((first, second) => first.number - second.number);
  const by = earlier.findLast(({ startedOver }) => startedOver !== null)?.startedOver;
  return by ? { by, earlierRuns: earlier.length } : null;
}

function currentKeyOf(
  taskStages: readonly TaskStage[],
  walk: readonly WalkStep[],
  taskState: TaskState,
): string | null {
  if (taskState === "done" || taskState === "dropped") return null;
  const last = walk.at(-1);
  if (last) return last.stageKey;
  return taskStages.find(({ state }) => HOLDING_STATES.includes(state))?.stage.key ?? null;
}

/** The Stages a Restart from… jumped over, in Pipeline order: those between, marked Skipped. */
function skippedBetween(
  taskStages: readonly TaskStage[],
  fromKey: string,
  toKey: string,
): readonly string[] {
  const from = taskStages.findIndex(({ stage }) => stage.key === fromKey);
  const to = taskStages.findIndex(({ stage }) => stage.key === toKey);
  return taskStages
    .slice(from + 1, Math.max(from + 1, to))
    .filter(({ state }) => state === "skipped")
    .map(({ stage }) => stage.key);
}

/**
 * N of "Round n of ≤N": the first round and one more for each time the routes back spanning the
 * Stage may take the work back. Null when a spanning route has No limit, none spans the Stage, or
 * the rounds are past it (the user allowed more).
 */
export function roundBound(
  taskStages: readonly TaskStage[],
  key: string,
  rounds: number,
): number | null {
  const flow = taskStages.map(({ stage }) => stage);
  const at = flow.findIndex((stage) => stage.key === key);
  let bound = 1;
  let bounded = false;
  for (const [from, stage] of flow.entries()) {
    for (const route of stage.routes ?? []) {
      if (!isRouteBack(flow, stage.key, route.to)) continue;
      const to = flow.findIndex(({ key: other }) => other === route.to);
      if (to > at || at > from) continue;
      const limit = limitOf(flow, stage.key, route);
      if (limit === null) return null;
      bound += limit;
      bounded = true;
    }
  }
  return bounded && rounds <= bound ? bound : null;
}

/** What the canvas needs of the walk to draw its progress. */
export function flowProgressOf({
  stages,
  currentKey,
  taken,
  started,
}: PipelineProgress): FlowProgress {
  return {
    started,
    taken,
    current: currentKey,
    ran: new Set(
      stages.filter(({ steps }) => steps.length > 0).map(({ taskStage }) => taskStage.stage.key),
    ),
    quiet: new Set(
      stages
        .filter(({ taskStage: { state } }) => state === "not-taken" || state === "skipped")
        .map(({ taskStage }) => taskStage.stage.key),
    ),
  };
}
