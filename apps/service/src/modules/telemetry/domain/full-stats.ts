import type { StatsProjectFilter, StatsTask } from "./basic-stats.js";

/** The full stats' ranges (spec 2.11). */
export type FullStatsRange = "24h" | "7d" | "30d";

/** What tokens and estimated cost over time are split by. */
export type FullStatsSplit = "model" | "role" | "stage" | "pipeline" | "project";

/** Counted tokens (cache reads left out) and their estimated cost in US dollars. */
export interface Spend {
  readonly tokens: number;
  readonly estimatedCostUsd: number;
}

/** One value of a series at the step starting `at`. */
export interface SeriesPoint {
  readonly at: Date;
  readonly value: number;
}

/** A series of one split value; `name` is "" where the attribute was empty. */
export interface NamedSeries {
  readonly name: string;
  readonly points: readonly SeriesPoint[];
}

/** Tokens and estimated cost over time, each by the split's values. */
export interface UsageSeries {
  readonly tokens: readonly NamedSeries[];
  readonly estimatedCostUsd: readonly NamedSeries[];
}

/**
 * A Stage run's calls within a Task on one engine and model, `stageRun` the run's number on its
 * Task as the records carry it (`office.stage.run`); `stageName` and `stageRun` are "" for the
 * calls outside a Stage. `firstAt` is when its first record came.
 */
export interface StageRunSpend extends Spend {
  readonly stageName: string;
  readonly stageRun: string;
  readonly engineId: string;
  readonly model: string;
  readonly firstAt: Date;
}

/** A Task's totals in the range, with its Stage runs' spend. */
export interface TaskSpend extends Spend {
  readonly taskId: string;
  readonly runs: readonly StageRunSpend[];
}

/**
 * An Initiative's calls on one of its Tasks ("" for its own Threads), in one Stage run of it ("" for
 * the calls outside a Stage), on one engine and model.
 */
export interface InitiativeTaskSpend extends Spend {
  readonly taskId: string;
  readonly stageRun: string;
  readonly engineId: string;
  readonly model: string;
}

/** An Initiative's totals in the range, with its Tasks'. */
export interface InitiativeSpend extends Spend {
  readonly initiativeId: string;
  readonly tasks: readonly InitiativeTaskSpend[];
}

/** The most expensive Tasks and Initiatives in the range, as the logs total them. */
export interface CostliestSpend {
  readonly tasks: readonly TaskSpend[];
  readonly initiatives: readonly InitiativeSpend[];
}

export type UsageWindowName = "five_hour" | "seven_day";

/** How full one engine's Usage window was over the range, from 0 to 100. */
export interface WindowSeries {
  readonly engineId: string;
  readonly window: UsageWindowName;
  readonly points: readonly SeriesPoint[];
}

/** An Agent Stage run that overlapped the range; `endedAt` undefined while it runs. */
export interface StatsStageRunSpan {
  readonly engineId: string;
  readonly taskId: string;
  readonly stageName: string;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
}

/** An Initiative as Work keeps it, for the most expensive list. */
export interface StatsInitiative {
  readonly initiativeId: string;
  readonly title: string;
  readonly projectIds: readonly string[];
}

/** An engine as Pipelines' records name it: its id and its name at the time, if one was kept. */
export interface StatsNamedEngine {
  readonly engineId: string;
  readonly engineName: string | undefined;
}

/**
 * The engines a Stage run ran on, as Pipelines keeps it: `number` its number on its Task, the
 * engine it ran on last, the cascade's engine it stood in for, and each switch of engine mid-run.
 */
export interface StatsStageRunEngines extends StatsNamedEngine {
  readonly taskId: string;
  readonly number: number;
  readonly standInFor: StatsNamedEngine | undefined;
  readonly switches: readonly {
    readonly fromEngineId: string;
    readonly fromEngineName: string;
    readonly toEngineId: string;
    readonly toEngineName: string;
  }[];
}

/** An engine's id and its name now (Settings › Engines). */
export interface StatsEngineName {
  readonly engineId: string;
  readonly name: string;
}

/** A Project's id and its name, which the metrics and logs carry. */
export interface StatsProjectName {
  readonly projectId: string;
  readonly name: string;
}

/** How many Tasks and how many Initiatives the most expensive lists hold at most (spec 2.11). */
export const COSTLIEST = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long each range is, ending now. */
const RANGE_MS: Readonly<Record<FullStatsRange, number>> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/** The step tokens and estimated cost over time go by: fixed steps in UTC, not office days. */
const USAGE_STEP_MS: Readonly<Record<FullStatsRange, number>> = {
  "24h": HOUR_MS,
  "7d": 6 * HOUR_MS,
  "30d": DAY_MS,
};

/** The step the Usage windows over time go by, finer, as a reset shows as the line dropping. */
const WINDOWS_STEP_MS: Readonly<Record<FullStatsRange, number>> = {
  "24h": 15 * MINUTE_MS,
  "7d": HOUR_MS,
  "30d": 6 * HOUR_MS,
};

/** A range of the full stats as read: `from` to `to`, and the steps each chart goes by. */
export interface FullStatsSpan {
  /** `to` less the range's length. */
  readonly from: Date;
  readonly to: Date;
  readonly usageStepMs: number;
  readonly windowsStepMs: number;
}

/** The range ending `now`. */
export function fullStatsSpanOf(range: FullStatsRange, now: Date): FullStatsSpan {
  return {
    from: new Date(now.getTime() - RANGE_MS[range]),
    to: now,
    usageStepMs: USAGE_STEP_MS[range],
    windowsStepMs: WINDOWS_STEP_MS[range],
  };
}

/** The start of the step `at` falls in: the epoch's milliseconds floored to the step, in UTC. */
export function stepStartOf(at: Date, stepMs: number): Date {
  return new Date(Math.floor(at.getTime() / stepMs) * stepMs);
}

/** The end of the step `at` falls in, so a range read in steps covers the step still going on. */
export function stepEndOf(at: Date, stepMs: number): Date {
  return new Date(stepStartOf(at, stepMs).getTime() + stepMs);
}

/** The start of every step from the one `from` falls in to the one `to` falls in, oldest first. */
export function stepsOf(from: Date, to: Date, stepMs: number): Date[] {
  const steps: Date[] = [];
  for (let at = stepStartOf(from, stepMs).getTime(); at <= to.getTime(); at += stepMs) {
    steps.push(new Date(at));
  }
  return steps;
}

/** One step of tokens and estimated cost, by the split's values; a step with nothing has none. */
export interface UsageBucket {
  readonly at: Date;
  readonly groups: readonly (Spend & { readonly name: string })[];
}

/**
 * Tokens and estimated cost over time, one bucket per step of `steps`, gaps filled: each series'
 * points are joined by name in the step they fall in, and a value with neither tokens nor estimated
 * cost is left out. Points outside the steps are left out.
 */
export function usageBucketsOf(
  usage: UsageSeries,
  steps: readonly Date[],
  stepMs: number,
): UsageBucket[] {
  const byStep = new Map(steps.map((at) => [at.getTime(), new Map<string, Spend>()]));
  const add = (series: readonly NamedSeries[], kind: keyof Spend) => {
    for (const { name, points } of series) {
      for (const { at, value } of points) {
        const groups = byStep.get(stepStartOf(at, stepMs).getTime());
        if (!groups) continue;
        const spend = groups.get(name) ?? { tokens: 0, estimatedCostUsd: 0 };
        groups.set(name, { ...spend, [kind]: spend[kind] + value });
      }
    }
  };
  add(usage.tokens, "tokens");
  add(usage.estimatedCostUsd, "estimatedCostUsd");
  return steps.map((at) => ({
    at,
    groups: [...(byStep.get(at.getTime()) ?? [])]
      .filter(([, { tokens, estimatedCostUsd }]) => tokens > 0 || estimatedCostUsd > 0)
      .map(([name, spend]) => ({ name, ...spend }))
      .toSorted((one, other) => one.name.localeCompare(other.name)),
  }));
}

/**
 * What some calls ran on: the engine by its name ("Removed engine" when no longer known) and the
 * model, with the engine it stood in for when they were a Stage run's on a Stand-in Engine.
 */
export interface RanOn extends Spend {
  readonly engineName: string;
  readonly model: string;
  readonly standInForEngineName: string | undefined;
}

/** What an engine no longer known reads as. */
export const REMOVED_ENGINE = "Removed engine";

/** One try of a Stage: 1, then 2 for its first Stage retry, and so on. */
export interface StageTry extends Spend {
  readonly try: number;
  /** Most estimated cost first. */
  readonly ranOn: readonly RanOn[];
}

export interface StageSpend {
  readonly stageName: string;
  readonly tries: readonly StageTry[];
}

/** A Task among the most expensive, with its estimated cost per Stage and per try. */
export interface CostliestTask extends Spend {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  /** In the order each Stage first ran. */
  readonly stages: readonly StageSpend[];
  /** Its calls outside a Stage: its planning, a person's own Thread on it. */
  readonly outsideStages: Spend;
}

/** An Initiative among the most expensive, with its Tasks and its own Threads. */
export interface CostliestInitiative extends Spend {
  readonly initiativeId: string;
  readonly title: string;
  readonly projectIds: readonly string[];
  /** Most estimated cost first. */
  readonly tasks: readonly CostliestInitiativeTask[];
  readonly ownThreads: Spend;
}

export interface CostliestInitiativeTask extends Spend {
  readonly taskId: string;
  readonly title: string;
  /** Most estimated cost first. */
  readonly ranOn: readonly RanOn[];
}

export interface Costliest {
  readonly tasks: readonly CostliestTask[];
  readonly initiatives: readonly CostliestInitiative[];
}

/**
 * The most expensive Tasks and Initiatives, up to `COSTLIEST` each, most estimated cost first. A
 * Task or Initiative The Office no longer knows is left out, and so is an Initiative's Task. What
 * each try and each Initiative's Task ran on is named from its Stage runs' engines, then from the
 * engines now.
 */
export function costliestOf({
  spend,
  tasks,
  initiatives,
  stageRunEngines,
  engines,
}: {
  readonly spend: CostliestSpend;
  readonly tasks: readonly StatsTask[];
  readonly initiatives: readonly StatsInitiative[];
  readonly stageRunEngines: readonly StatsStageRunEngines[];
  readonly engines: readonly StatsEngineName[];
}): Costliest {
  const knownTasks = new Map(tasks.map((task) => [task.id, task]));
  const knownInitiatives = new Map(initiatives.map((one) => [one.initiativeId, one]));
  const ranOn = ranOnOf(stageRunEngines, engines);
  return {
    tasks: spend.tasks
      .flatMap((taskSpend) => {
        const task = knownTasks.get(taskSpend.taskId);
        return task ? [costliestTaskOf(taskSpend, task, ranOn)] : [];
      })
      .toSorted(byCost((task) => task.taskId))
      .slice(0, COSTLIEST),
    initiatives: spend.initiatives
      .flatMap((initiativeSpend) => {
        const initiative = knownInitiatives.get(initiativeSpend.initiativeId);
        return initiative
          ? [costliestInitiativeOf(initiativeSpend, initiative, knownTasks, ranOn)]
          : [];
      })
      .toSorted(byCost((initiative) => initiative.initiativeId))
      .slice(0, COSTLIEST),
  };
}

/** Some of a Task's calls, in one Stage run of it or none (""), on one engine and model. */
interface CallsOnEngine extends Spend {
  readonly taskId: string;
  readonly stageRun: string;
  readonly engineId: string;
  readonly model: string;
}

/** What the calls ran on, added up by engine name, model and stand-in, most estimated cost first. */
type RanOnOf = (calls: readonly CallsOnEngine[]) => RanOn[];

/**
 * Calls are on a Stand-in Engine when their Stage run stood in for the cascade's engine and they
 * didn't run on that one. An engine is named as its Stage run named it at the time, else by its
 * name now, else `REMOVED_ENGINE`.
 */
function ranOnOf(
  stageRunEngines: readonly StatsStageRunEngines[],
  engines: readonly StatsEngineName[],
): RanOnOf {
  const namesNow = new Map(engines.map(({ engineId, name }) => [engineId, name]));
  const runs = new Map(
    stageRunEngines.map((run) => [
      stageRunKey(run.taskId, String(run.number)),
      { run, names: engineNamesIn(run) },
    ]),
  );
  return (calls) => {
    const pieces = new Map<string, RanOn>();
    for (const call of calls) {
      const known =
        call.stageRun === "" ? undefined : runs.get(stageRunKey(call.taskId, call.stageRun));
      const nameOf = (engineId: string) =>
        known?.names.get(engineId) ?? namesNow.get(engineId) ?? REMOVED_ENGINE;
      const standInFor = known?.run.standInFor;
      const piece = {
        engineName: nameOf(call.engineId),
        model: call.model,
        standInForEngineName:
          standInFor !== undefined && call.engineId !== standInFor.engineId
            ? nameOf(standInFor.engineId)
            : undefined,
      };
      const key = JSON.stringify([piece.engineName, piece.model, piece.standInForEngineName]);
      pieces.set(key, { ...piece, ...sum([pieces.get(key) ?? NO_SPEND, call]) });
    }
    return [...pieces.values()].toSorted(
      byCost(({ engineName, model, standInForEngineName }) =>
        [engineName, model, standInForEngineName ?? ""].join("\n"),
      ),
    );
  };
}

function stageRunKey(taskId: string, stageRun: string): string {
  return JSON.stringify([taskId, stageRun]);
}

/** The names a Stage run's records gave its engines. */
function engineNamesIn(run: StatsStageRunEngines): Map<string, string> {
  const names = new Map<string, string>();
  const named = ({ engineId, engineName }: StatsNamedEngine) => {
    if (engineName !== undefined) names.set(engineId, engineName);
  };
  for (const one of run.switches) {
    named({ engineId: one.fromEngineId, engineName: one.fromEngineName });
    named({ engineId: one.toEngineId, engineName: one.toEngineName });
  }
  if (run.standInFor) named(run.standInFor);
  named(run);
  return names;
}

function costliestTaskOf(spend: TaskSpend, task: StatsTask, ranOn: RanOnOf): CostliestTask {
  const inStages = spend.runs
    .filter(({ stageName }) => stageName !== "")
    .toSorted((one, other) => one.firstAt.getTime() - other.firstAt.getTime());
  // A Stage's tries in the order each run's first call came, each with its calls on every engine.
  const stages = new Map<string, Map<string, StageRunSpend[]>>();
  for (const run of inStages) {
    const runs = stages.get(run.stageName) ?? new Map<string, StageRunSpend[]>();
    runs.set(run.stageRun, [...(runs.get(run.stageRun) ?? []), run]);
    stages.set(run.stageName, runs);
  }
  const callsOf = (parts: readonly StageRunSpend[]) =>
    parts.map((part) => ({ ...part, taskId: spend.taskId }));
  return {
    taskId: spend.taskId,
    title: task.title,
    projectId: task.projectId,
    tokens: spend.tokens,
    estimatedCostUsd: spend.estimatedCostUsd,
    stages: [...stages].map(([stageName, runs]) => ({
      stageName,
      tries: [...runs.values()].map((parts, index) => ({
        try: index + 1,
        ...sum(parts),
        ranOn: ranOn(callsOf(parts)),
      })),
    })),
    outsideStages: sum(spend.runs.filter(({ stageName }) => stageName === "")),
  };
}

function costliestInitiativeOf(
  spend: InitiativeSpend,
  initiative: StatsInitiative,
  knownTasks: ReadonlyMap<string, StatsTask>,
  ranOn: RanOnOf,
): CostliestInitiative {
  const byTask = new Map<string, InitiativeTaskSpend[]>();
  for (const part of spend.tasks)
    byTask.set(part.taskId, [...(byTask.get(part.taskId) ?? []), part]);
  return {
    initiativeId: initiative.initiativeId,
    title: initiative.title,
    projectIds: initiative.projectIds,
    tokens: spend.tokens,
    estimatedCostUsd: spend.estimatedCostUsd,
    tasks: [...byTask]
      .flatMap(([taskId, parts]) => {
        const task = taskId === "" ? undefined : knownTasks.get(taskId);
        return task ? [{ taskId, title: task.title, ...sum(parts), ranOn: ranOn(parts) }] : [];
      })
      .toSorted(byCost(({ taskId }) => taskId)),
    ownThreads: sum(byTask.get("") ?? []),
  };
}

const NO_SPEND: Spend = { tokens: 0, estimatedCostUsd: 0 };

function sum(spends: readonly Spend[]): Spend {
  return spends.reduce(
    (total, { tokens, estimatedCostUsd }) => ({
      tokens: total.tokens + tokens,
      estimatedCostUsd: total.estimatedCostUsd + estimatedCostUsd,
    }),
    NO_SPEND,
  );
}

/** Most estimated cost first, then most tokens, then by id so the order holds. */
function byCost<T extends Spend>(idOf: (one: T) => string): (one: T, other: T) => number {
  return (one, other) =>
    other.estimatedCostUsd - one.estimatedCostUsd ||
    other.tokens - one.tokens ||
    idOf(one).localeCompare(idOf(other));
}

/** How full a Usage window was at the step starting `at`, from 0 to 100. */
export interface WindowPoint {
  readonly at: Date;
  readonly percentUsed: number;
}

/** An engine's Usage windows over the range. */
export interface WindowsOverTime {
  readonly engineId: string;
  readonly name: string;
  readonly fiveHour: readonly WindowPoint[];
  readonly sevenDay: readonly WindowPoint[];
}

/** An engine as Settings › Engines lists it, and whether it has Usage windows. */
export interface StatsEngineWithWindows {
  readonly engineId: string;
  readonly name: string;
  readonly hasWindows: boolean;
}

/**
 * Each engine with Usage windows, in the order given, with its two windows' series, oldest first;
 * a window with no series is empty, and the series of an engine not given are left out.
 */
export function windowsOverTimeOf(
  series: readonly WindowSeries[],
  engines: readonly StatsEngineWithWindows[],
): WindowsOverTime[] {
  const pointsOf = (engineId: string, window: UsageWindowName): WindowPoint[] =>
    series
      .filter((one) => one.engineId === engineId && one.window === window)
      .flatMap(({ points }) => points.map(({ at, value }) => ({ at, percentUsed: value })))
      .toSorted((one, other) => one.at.getTime() - other.at.getTime());
  return engines
    .filter(({ hasWindows }) => hasWindows)
    .map(({ engineId, name }) => ({
      engineId,
      name,
      fiveHour: pointsOf(engineId, "five_hour"),
      sevenDay: pointsOf(engineId, "seven_day"),
    }));
}

/** An Agent Stage run in the range, with its Task's title and Project. */
export interface RunningStageRun extends StatsStageRunSpan {
  readonly title: string;
  readonly projectId: string;
}

/**
 * The lane of what was running, oldest first: each run with its Task's title and Project, a run
 * whose Task The Office no longer knows left out, narrowed by the Project filter.
 */
export function runningOf(
  spans: readonly StatsStageRunSpan[],
  tasks: readonly StatsTask[],
  filter: StatsProjectFilter,
): RunningStageRun[] {
  const known = new Map(tasks.map((task) => [task.id, task]));
  return spans
    .flatMap((span) => {
      const task = known.get(span.taskId);
      if (!task || (filter !== "all" && !filter.includes(task.projectId))) return [];
      return [{ ...span, title: task.title, projectId: task.projectId }];
    })
    .toSorted((one, other) => one.startedAt.getTime() - other.startedAt.getTime());
}

/**
 * Whether Grafana holds nothing The Office sent for the range: no usage point above zero, no Task
 * or Initiative with spend, and no Usage window point.
 */
export function holdsNoData({
  usage,
  costliest,
  windows,
}: {
  readonly usage: UsageSeries;
  readonly costliest: CostliestSpend;
  readonly windows: readonly WindowSeries[];
}): boolean {
  return (
    !anyAboveZero(usage.tokens) &&
    !anyAboveZero(usage.estimatedCostUsd) &&
    costliest.tasks.length === 0 &&
    costliest.initiatives.length === 0 &&
    windows.every(({ points }) => points.length === 0)
  );
}

function anyAboveZero(series: readonly NamedSeries[]): boolean {
  return series.some(({ points }) => points.some(({ value }) => value > 0));
}
