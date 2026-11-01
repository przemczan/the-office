import {
  addTokens,
  NO_STAGE_TOKENS,
  type StageRun,
  type StageTokens,
  type UsageWindowReading,
} from "./stage-run.js";

/** How many of the latest done Tasks a Usage estimate learns from (spec §2.1). */
export const HISTORY_TASKS = 20;

/** The account's usage windows, as a reading names them. */
export type UsageWindowName = keyof Pick<UsageWindowReading, "fiveHour" | "sevenDay">;
export const USAGE_WINDOW_NAMES: readonly UsageWindowName[] = ["fiveHour", "sevenDay"];

/** The median of a Stage's window samples, in percentage points, and how many there were. */
export interface WindowChange {
  readonly percentUsed: number;
  readonly samples: number;
}

/**
 * What one Stage used in the done Tasks: the median of each token kind over its samples, a sample
 * being the sum of its runs in one Task, so loops and send-backs count. Each window has its own
 * samples, as only some runs' readings count; undefined with none.
 */
export interface StageUsage {
  readonly tokens: StageTokens;
  readonly samples: number;
  readonly windows: Readonly<Record<UsageWindowName, WindowChange | undefined>>;
}

/** Each Stage's usage, by Stage key. */
export type StageUsages = ReadonlyMap<string, StageUsage>;

/** Tokens on one engine, as a Role card names it, and model, with what they cost. */
export interface PricedTokens {
  readonly tokens: StageTokens;
  /** Undefined when the model has no Model price. */
  readonly dollars: number | undefined;
}

/** Tokens on one engine and model, summed over runs. */
export interface ModelTokens {
  readonly engine: string;
  readonly model: string;
  readonly tokens: StageTokens;
}

/**
 * The Office-wide ratios to tokens a Planner's token estimate is turned into window % and dollars
 * by; undefined where no run gives one.
 */
export interface UsageRatios {
  readonly percentUsedPerToken: Readonly<Record<UsageWindowName, number | undefined>>;
  readonly dollarsPerToken: number | undefined;
}

/** Tokens as every token count gives them: input, output and cache writes, not cache reads. */
export function countedTokens({ input, output, cacheCreation }: StageTokens): number {
  return input + output + cacheCreation;
}

/** The ended runs of the `limit` Tasks whose last run ended latest. */
export function latestTasksRuns(
  runs: readonly StageRun[],
  limit: number = HISTORY_TASKS,
): readonly StageRun[] {
  const ended = runs.filter(({ endedAt }) => endedAt !== undefined);
  const latest = new Set(
    [...lastEndOfEachTask(ended)]
      .toSorted(([, one], [, other]) => other - one)
      .slice(0, limit)
      .map(([taskId]) => taskId),
  );
  return ended.filter(({ taskId }) => latest.has(taskId));
}

/** Each Stage's median tokens and window changes over the Tasks `runs` belong to. */
export function stageUsages(runs: readonly StageRun[]): StageUsages {
  const samples = groupBy(runs, ({ stageKey }) => stageKey);
  return new Map(
    [...samples].map(([stageKey, stageRuns]) => [stageKey, stageUsage(stageRuns)] as const),
  );
}

/** The runs' tokens summed by engine and model; a run without either is left out. */
export function tokensByModel(runs: readonly StageRun[]): readonly ModelTokens[] {
  const byModel = new Map<string, ModelTokens>();
  for (const { engine, model, tokens } of runs) {
    if (engine === undefined || model === undefined) continue;
    const key = JSON.stringify([engine, model]);
    const summed = byModel.get(key)?.tokens ?? NO_STAGE_TOKENS;
    byModel.set(key, { engine, model, tokens: addTokens(summed, tokens) });
  }
  return [...byModel.values()];
}

/**
 * Window % per token over the runs whose readings count, and dollars per token over the tokens
 * that have a Model price.
 */
export function usageRatios(
  runs: readonly StageRun[],
  priced: readonly PricedTokens[],
): UsageRatios {
  const windowRatio = (window: UsageWindowName): number | undefined => {
    const counted = runs.flatMap((run) => {
      const change = windowChangeOf(run, window);
      return change === undefined ? [] : [{ amount: change, tokens: countedTokens(run.tokens) }];
    });
    return ratio(counted);
  };
  return {
    percentUsedPerToken: { fiveHour: windowRatio("fiveHour"), sevenDay: windowRatio("sevenDay") },
    dollarsPerToken: ratio(
      priced.flatMap(({ tokens, dollars }) =>
        dollars === undefined ? [] : [{ amount: dollars, tokens: countedTokens(tokens) }],
      ),
    ),
  };
}

/**
 * The run's share of a window's change, in percentage points; undefined unless both readings
 * exist, the window didn't reset during the run, and the Office's tokens didn't go down (a restart
 * between the readings). The change is scaled by the run's share of the Office's tokens between
 * the readings, which takes out parallel runs and chats.
 */
export function windowChangeOf(run: StageRun, window: UsageWindowName): number | undefined {
  const { usageWindowsAtStart: start, usageWindowsAtEnd: end } = run;
  if (start === undefined || end === undefined) return undefined;
  const officeTokens =
    countedTokens(end.officeTokensSoFar) - countedTokens(start.officeTokensSoFar);
  if (officeTokens <= 0) return undefined;
  const before = start[window];
  const after = end[window];
  if (before.resetsAt !== undefined && end.readAt >= before.resetsAt) return undefined;
  const change = after.percentUsed - before.percentUsed;
  if (change < 0) return undefined;
  return change * Math.min(1, countedTokens(run.tokens) / officeTokens);
}

function stageUsage(runs: readonly StageRun[]): StageUsage {
  const samples = [...groupBy(runs, ({ taskId }) => taskId).values()];
  const tokens = samples.map((sample) => sample.map((run) => run.tokens).reduce(addTokens));
  const windowChange = (window: UsageWindowName): WindowChange | undefined => {
    const changes = samples.flatMap((sample) => {
      const each = sample.map((run) => windowChangeOf(run, window));
      return each.every((one): one is number => one !== undefined) ? [sum(each)] : [];
    });
    return changes.length === 0
      ? undefined
      : { percentUsed: median(changes), samples: changes.length };
  };
  return {
    tokens: {
      input: median(tokens.map(({ input }) => input)),
      output: median(tokens.map(({ output }) => output)),
      cacheRead: median(tokens.map(({ cacheRead }) => cacheRead)),
      cacheCreation: median(tokens.map(({ cacheCreation }) => cacheCreation)),
    },
    samples: samples.length,
    windows: { fiveHour: windowChange("fiveHour"), sevenDay: windowChange("sevenDay") },
  };
}

function lastEndOfEachTask(runs: readonly StageRun[]): ReadonlyMap<string, number> {
  const lastEnd = new Map<string, number>();
  for (const { taskId, endedAt } of runs) {
    const ended = endedAt?.getTime() ?? 0;
    lastEnd.set(taskId, Math.max(lastEnd.get(taskId) ?? ended, ended));
  }
  return lastEnd;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): ReadonlyMap<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function ratio(parts: readonly { amount: number; tokens: number }[]): number | undefined {
  const tokens = sum(parts.map((part) => part.tokens));
  return tokens === 0 ? undefined : sum(parts.map((part) => part.amount)) / tokens;
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, each) => total + each, 0);
}

/** The middle value, or the mean of the two middle ones; `numbers` is never empty here. */
function median(numbers: readonly number[]): number {
  const sorted = numbers.toSorted((one, other) => one - other);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
