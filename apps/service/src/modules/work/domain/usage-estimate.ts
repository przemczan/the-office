import type { EngineId } from "../../engine/index.js";

/*
 * A Ready Task's Usage estimate (spec §2.1): what its whole Pipeline is expected to use on each
 * engine id its Stages' Roles' engines spend on, as caps, readings and each day's use are kept.
 * History wins at 3 done Tasks of the same Project and Pipeline: each Stage's median, summed. Below
 * that the Planner's token estimate stands in, split evenly over the Agent Stages, its cost from the
 * Office-wide dollars per token. Either way, window % is the tokens times the engine id's
 * Office-wide window % per token, learnt from successive readings (spec §5.4).
 */

/** How many done Tasks the history needs before it wins over the Planner's estimate. */
export const HISTORY_WINS_AT = 3;

/** The measures Settings › Office limits may tick. */
export const USAGE_MEASURES = ["tokens", "fiveHourWindow", "sevenDayWindow", "cost"] as const;
export type UsageMeasure = (typeof USAGE_MEASURES)[number];

/** Ticked until the user changes them. */
export const DEFAULT_USAGE_MEASURES: readonly UsageMeasure[] = ["tokens", "fiveHourWindow"];

/** Tokens kind by kind, as a Stage run counts them. */
export interface StageTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/** The account's usage windows. */
export type UsageWindowName = "fiveHour" | "sevenDay";

/** What one Stage used in the done Tasks, as Pipelines' history gives it: medians and samples. */
export interface StageUsage {
  readonly tokens: StageTokens;
  readonly samples: number;
}

/** Each Stage's usage, by Stage key. */
export type StageUsages = ReadonlyMap<string, StageUsage>;

/** Window % per counted token on one engine id, Office-wide; undefined where no pair gives one. */
export type WindowRatios = Readonly<Record<UsageWindowName, number | undefined>>;

/** Each engine id's window ratios; an engine whose account has no usage windows has none. */
export type EngineWindowRatios = ReadonlyMap<EngineId, WindowRatios>;

/** A Stage of a Pipeline in the library; an Agent Stage names its Role or a duty. */
export interface PipelineStage {
  readonly key: string;
  readonly name: string;
  readonly role?: string;
  /** The key of the duty whose holder works it, when it names one rather than a Role. */
  readonly duty?: string;
}

/** An Agent Stage with the engine id its engine spends on and the model it would work with. */
export interface EstimatedStage {
  readonly key: string;
  readonly engineId: EngineId;
  readonly model: string;
}

/** Each window's %; undefined where there is no estimate of it. */
export type EngineWindows = Readonly<Record<UsageWindowName, number | undefined>>;

/** What a Pipeline is expected to use on one engine id; undefined where there is no estimate. */
export interface EngineUsage {
  readonly engineId: EngineId;
  readonly tokens: number;
  /** Undefined on an engine whose account has no usage windows. */
  readonly windows: EngineWindows | undefined;
  /** Dollars; undefined is "no cost". */
  readonly cost: number | undefined;
}

export type UsageEstimateBasis =
  | { readonly source: "history"; readonly tasks: number }
  | { readonly source: "planner" }
  | { readonly source: "none" };

/**
 * A Task's Usage estimate in every measure, with the measures ticked when it was made, which alone
 * are shown and hold a Start. "No estimate" has no engines.
 */
export interface UsageEstimate {
  readonly basis: UsageEstimateBasis;
  readonly engines: readonly EngineUsage[];
  readonly measures: readonly UsageMeasure[];
}

/**
 * How many done Tasks the history has of these Stages: the most samples any of them has, as a
 * done Task ran at least one of them.
 */
export function tasksInHistory(stages: readonly EstimatedStage[], history: StageUsages): number {
  return Math.max(0, ...stages.map(({ key }) => history.get(key)?.samples ?? 0));
}

/**
 * Each Stage's median, summed per engine id, its windows by the engine id's ratios. A Stage the
 * history never ran adds nothing. Cost only when every such Stage's model has a price
 * (`stageCosts`, dollars by Stage key).
 */
export function historyUsage(
  stages: readonly EstimatedStage[],
  history: StageUsages,
  stageCosts: ReadonlyMap<string, number | undefined>,
  windowRatios: EngineWindowRatios,
): readonly EngineUsage[] {
  return engineIdsOf(stages).map((engineId) => {
    const ran = stages.flatMap((stage) => {
      const usage = history.get(stage.key);
      return stage.engineId === engineId && usage ? [{ key: stage.key, usage }] : [];
    });
    const tokens = sum(ran.map(({ usage }) => countedTokens(usage.tokens)));
    return {
      engineId,
      tokens: Math.round(tokens),
      windows: windowsOf(tokens, windowRatios.get(engineId)),
      cost: sumOrUndefined(ran.map(({ key }) => stageCosts.get(key))),
    };
  });
}

/**
 * The Planner's tokens split evenly over the Agent Stages, summed per engine id; windows by the
 * engine id's ratios, cost by the Office-wide dollars per token.
 */
export function plannerUsage(
  stages: readonly EstimatedStage[],
  estimatedTokens: number,
  windowRatios: EngineWindowRatios,
  dollarsPerToken: number | undefined,
): readonly EngineUsage[] {
  return engineIdsOf(stages).map((engineId) => {
    const share = stages.filter((stage) => stage.engineId === engineId).length / stages.length;
    const tokens = estimatedTokens * share;
    return {
      engineId,
      tokens: Math.round(tokens),
      windows: windowsOf(tokens, windowRatios.get(engineId)),
      cost: dollarsPerToken === undefined ? undefined : tokens * dollarsPerToken,
    };
  });
}

/**
 * What `usage` comes to on another engine id, `engineId`, such as a Stand-in Engine running the
 * same model: the same tokens and cost, its windows by that engine id's ratios.
 */
export function movedTo(
  usage: EngineUsage,
  engineId: EngineId,
  ratios: WindowRatios | undefined,
): EngineUsage {
  return { ...usage, engineId, windows: windowsOf(usage.tokens, ratios) };
}

/** Two estimates on the same engine id, summed: a window or cost either lacks, the other's alone. */
export function mergedUsage(one: EngineUsage, other: EngineUsage): EngineUsage {
  const windows =
    one.windows === undefined || other.windows === undefined
      ? (one.windows ?? other.windows)
      : {
          fiveHour: plus(one.windows.fiveHour, other.windows.fiveHour),
          sevenDay: plus(one.windows.sevenDay, other.windows.sevenDay),
        };
  return {
    engineId: one.engineId,
    tokens: one.tokens + other.tokens,
    windows,
    cost: plus(one.cost, other.cost),
  };
}

/** The sum of two optional amounts: either alone when the other is missing. */
function plus(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : a + b;
}

/** Each window's % for `tokens`; none on an engine id without ratios, nor for a window without one. */
function windowsOf(tokens: number, ratios: WindowRatios | undefined): EngineWindows | undefined {
  if (ratios === undefined) return undefined;
  const windowOf = (name: UsageWindowName): number | undefined => {
    const perToken = ratios[name];
    return perToken === undefined ? undefined : tokens * perToken;
  };
  return { fiveHour: windowOf("fiveHour"), sevenDay: windowOf("sevenDay") };
}

/** Tokens as every token count gives them: input, output and cache writes, not cache reads. */
export function countedTokens({ input, output, cacheCreation }: StageTokens): number {
  return input + output + cacheCreation;
}

function engineIdsOf(stages: readonly EstimatedStage[]): readonly EngineId[] {
  return [...new Set(stages.map(({ engineId }) => engineId))];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumOrUndefined(values: readonly (number | undefined)[]): number | undefined {
  return values.every((value) => value !== undefined) ? sum(values) : undefined;
}
