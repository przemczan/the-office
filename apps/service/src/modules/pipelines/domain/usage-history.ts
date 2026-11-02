import { addTokens, NO_STAGE_TOKENS, type StageRun, type StageTokens } from "./stage-run.js";

/** How many of the latest done Tasks a Usage estimate learns from (spec §2.1). */
export const HISTORY_TASKS = 20;

/**
 * What one Stage used in the done Tasks: the median of each token kind over its samples, a sample
 * being the sum of its runs in one Task, so loops and send-backs count. Window % is not kept per
 * Stage: Work takes it from the Engine's Office-wide ratio (spec §5.4).
 */
export interface StageUsage {
  readonly tokens: StageTokens;
  readonly samples: number;
}

/** Each Stage's usage, by Stage key. */
export type StageUsages = ReadonlyMap<string, StageUsage>;

/** Tokens on one engine and model, with what they cost. */
export interface PricedTokens {
  readonly tokens: StageTokens;
  /** Undefined when the model has no Model price. */
  readonly dollars: number | undefined;
}

/** Tokens on one engine, by its id, and model, summed over runs. */
export interface ModelTokens {
  readonly engineId: string;
  readonly model: string;
  readonly tokens: StageTokens;
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

/** Each Stage's median tokens over the Tasks `runs` belong to. */
export function stageUsages(runs: readonly StageRun[]): StageUsages {
  const samples = groupBy(runs, ({ stageKey }) => stageKey);
  return new Map(
    [...samples].map(([stageKey, stageRuns]) => [stageKey, stageUsage(stageRuns)] as const),
  );
}

/** The runs' tokens summed by engine and model; a run without either is left out. */
export function tokensByModel(runs: readonly StageRun[]): readonly ModelTokens[] {
  const byModel = new Map<string, ModelTokens>();
  for (const { engineId, model, tokens } of runs) {
    if (engineId === undefined || model === undefined) continue;
    const key = JSON.stringify([engineId, model]);
    const summed = byModel.get(key)?.tokens ?? NO_STAGE_TOKENS;
    byModel.set(key, { engineId, model, tokens: addTokens(summed, tokens) });
  }
  return [...byModel.values()];
}

/** Dollars per counted token over the tokens that have a Model price; undefined with none. */
export function dollarsPerToken(priced: readonly PricedTokens[]): number | undefined {
  let dollars = 0;
  let tokens = 0;
  for (const each of priced) {
    if (each.dollars === undefined) continue;
    dollars += each.dollars;
    tokens += countedTokens(each.tokens);
  }
  return tokens === 0 ? undefined : dollars / tokens;
}

function stageUsage(runs: readonly StageRun[]): StageUsage {
  const samples = [...groupBy(runs, ({ taskId }) => taskId).values()];
  const tokens = samples.map((sample) => sample.map((run) => run.tokens).reduce(addTokens));
  return {
    tokens: {
      input: median(tokens.map(({ input }) => input)),
      output: median(tokens.map(({ output }) => output)),
      cacheRead: median(tokens.map(({ cacheRead }) => cacheRead)),
      cacheCreation: median(tokens.map(({ cacheCreation }) => cacheCreation)),
    },
    samples: samples.length,
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

/** The middle value, or the mean of the two middle ones; `numbers` is never empty here. */
function median(numbers: readonly number[]): number {
  const sorted = numbers.toSorted((one, other) => one - other);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
