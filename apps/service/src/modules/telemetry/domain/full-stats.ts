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
 * A Stage run's calls within a Task, `stageRun` an opaque id (`office.stage.run`); `stageName` and
 * `stageRun` are "" for the calls outside a Stage. `firstAt` is when its first record came.
 */
export interface StageRunSpend extends Spend {
  readonly stageName: string;
  readonly stageRun: string;
  readonly firstAt: Date;
}

/** A Task's totals in the range, with its Stage runs' spend. */
export interface TaskSpend extends Spend {
  readonly taskId: string;
  readonly runs: readonly StageRunSpend[];
}

/** An Initiative's totals in the range, with each Task's, "" for its own Threads. */
export interface InitiativeSpend extends Spend {
  readonly initiativeId: string;
  readonly tasks: readonly (Spend & { readonly taskId: string })[];
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

/** One try of a Stage: 1, then 2 for its first Stage retry, and so on. */
export interface StageTry extends Spend {
  readonly try: number;
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
  readonly tasks: readonly (Spend & { readonly taskId: string; readonly title: string })[];
  readonly ownThreads: Spend;
}

export interface Costliest {
  readonly tasks: readonly CostliestTask[];
  readonly initiatives: readonly CostliestInitiative[];
}

/**
 * The most expensive Tasks and Initiatives, up to `COSTLIEST` each, most estimated cost first. A
 * Task or Initiative The Office no longer knows is left out, and so is an Initiative's Task.
 */
export function costliestOf({
  spend,
  tasks,
  initiatives,
}: {
  readonly spend: CostliestSpend;
  readonly tasks: readonly StatsTask[];
  readonly initiatives: readonly StatsInitiative[];
}): Costliest {
  const knownTasks = new Map(tasks.map((task) => [task.id, task]));
  const knownInitiatives = new Map(initiatives.map((one) => [one.initiativeId, one]));
  return {
    tasks: spend.tasks
      .flatMap((taskSpend) => {
        const task = knownTasks.get(taskSpend.taskId);
        return task ? [costliestTaskOf(taskSpend, task)] : [];
      })
      .toSorted(byCost((task) => task.taskId))
      .slice(0, COSTLIEST),
    initiatives: spend.initiatives
      .flatMap((initiativeSpend) => {
        const initiative = knownInitiatives.get(initiativeSpend.initiativeId);
        return initiative ? [costliestInitiativeOf(initiativeSpend, initiative, knownTasks)] : [];
      })
      .toSorted(byCost((initiative) => initiative.initiativeId))
      .slice(0, COSTLIEST),
  };
}

function costliestTaskOf(spend: TaskSpend, task: StatsTask): CostliestTask {
  const inStages = spend.runs
    .filter(({ stageName }) => stageName !== "")
    .toSorted((one, other) => one.firstAt.getTime() - other.firstAt.getTime());
  const stages = new Map<string, Map<string, Spend>>();
  for (const run of inStages) {
    const runs = stages.get(run.stageName) ?? new Map<string, Spend>();
    runs.set(run.stageRun, sum([runs.get(run.stageRun) ?? NO_SPEND, run]));
    stages.set(run.stageName, runs);
  }
  return {
    taskId: spend.taskId,
    title: task.title,
    projectId: task.projectId,
    tokens: spend.tokens,
    estimatedCostUsd: spend.estimatedCostUsd,
    stages: [...stages].map(([stageName, runs]) => ({
      stageName,
      tries: [...runs.values()].map((run, index) => ({ try: index + 1, ...run })),
    })),
    outsideStages: sum(spend.runs.filter(({ stageName }) => stageName === "")),
  };
}

function costliestInitiativeOf(
  spend: InitiativeSpend,
  initiative: StatsInitiative,
  knownTasks: ReadonlyMap<string, StatsTask>,
): CostliestInitiative {
  return {
    initiativeId: initiative.initiativeId,
    title: initiative.title,
    projectIds: initiative.projectIds,
    tokens: spend.tokens,
    estimatedCostUsd: spend.estimatedCostUsd,
    tasks: spend.tasks
      .flatMap(({ taskId, tokens, estimatedCostUsd }) => {
        const task = taskId === "" ? undefined : knownTasks.get(taskId);
        return task ? [{ taskId, title: task.title, tokens, estimatedCostUsd }] : [];
      })
      .toSorted(byCost(({ taskId }) => taskId)),
    ownThreads: sum(spend.tasks.filter(({ taskId }) => taskId === "")),
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
