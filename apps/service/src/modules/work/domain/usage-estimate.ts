import type { Engine } from "../../engine/index.js";

/*
 * A Ready Task's Usage estimate (spec §2.1): what its whole Pipeline is expected to use on each
 * engine its Stages' Roles pick. History wins at 3 done Tasks of the same Project and Pipeline:
 * each Stage's median, summed. Below that the Planner's token estimate stands in, split evenly over
 * the Agent Stages, its window % and cost from the Office-wide ratios to tokens.
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
  readonly windows: Readonly<
    Record<UsageWindowName, { readonly percentUsed: number; readonly samples: number } | undefined>
  >;
}

/** Each Stage's usage, by Stage key. */
export type StageUsages = ReadonlyMap<string, StageUsage>;

/** The Office-wide ratios to tokens; undefined where no run gives one. */
export interface UsageRatios {
  readonly percentUsedPerToken: Readonly<Record<UsageWindowName, number | undefined>>;
  readonly dollarsPerToken: number | undefined;
}

/** A Stage of a Pipeline in the library; an Agent Stage names its Role, and may name a model. */
export interface PipelineStage {
  readonly key: string;
  readonly name: string;
  readonly role?: string;
  readonly model?: string;
}

/** An Agent Stage with the engine and model it would work with. */
export interface EstimatedStage {
  readonly key: string;
  readonly engine: Engine;
  readonly model: string;
}

/**
 * The engine and model an Agent Stage works with: its Role's engine, and its own model or else its
 * Role's, as the Stage runner opens its session. The one place this is decided.
 */
export function stageEngineAndModel(
  stage: PipelineStage,
  role: { readonly engine: Engine; readonly model: string },
): Pick<EstimatedStage, "engine" | "model"> {
  return { engine: role.engine, model: stage.model ?? role.model };
}

/** What a Pipeline is expected to use on one engine; undefined where there is no estimate. */
export interface EngineUsage {
  readonly engine: Engine;
  readonly tokens: number;
  readonly windows: Readonly<Record<UsageWindowName, number | undefined>>;
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

/** Whether `engine` reads the account's usage windows. */
export type ReadsUsageWindows = (engine: Engine) => boolean;

/**
 * How many done Tasks the history has of these Stages: the most samples any of them has, as a
 * done Task ran at least one of them.
 */
export function tasksInHistory(stages: readonly EstimatedStage[], history: StageUsages): number {
  return Math.max(0, ...stages.map(({ key }) => history.get(key)?.samples ?? 0));
}

/**
 * Each Stage's median, summed per engine. A Stage the history never ran adds nothing. A window is
 * estimated only when every Stage on the engine that ran has a change of it; cost only when every
 * such Stage's model has a price (`stageCosts`, dollars by Stage key).
 */
export function historyUsage(
  stages: readonly EstimatedStage[],
  history: StageUsages,
  stageCosts: ReadonlyMap<string, number | undefined>,
  readsUsageWindows: ReadsUsageWindows,
): readonly EngineUsage[] {
  return enginesOf(stages).map((engine) => {
    const ran = stages.flatMap((stage) => {
      const usage = history.get(stage.key);
      return stage.engine === engine && usage ? [{ key: stage.key, usage }] : [];
    });
    const windowSum = (name: UsageWindowName): number | undefined =>
      readsUsageWindows(engine)
        ? sumOrUndefined(ran.map(({ usage }) => usage.windows[name]?.percentUsed))
        : undefined;
    return {
      engine,
      tokens: Math.round(sum(ran.map(({ usage }) => countedTokens(usage.tokens)))),
      windows: { fiveHour: windowSum("fiveHour"), sevenDay: windowSum("sevenDay") },
      cost: sumOrUndefined(ran.map(({ key }) => stageCosts.get(key))),
    };
  });
}

/**
 * The Planner's tokens split evenly over the Agent Stages, summed per engine; window % and cost by
 * the Office-wide ratios, windows only on an engine that reads them.
 */
export function plannerUsage(
  stages: readonly EstimatedStage[],
  estimatedTokens: number,
  ratios: UsageRatios,
  readsUsageWindows: ReadsUsageWindows,
): readonly EngineUsage[] {
  return enginesOf(stages).map((engine) => {
    const share = stages.filter((stage) => stage.engine === engine).length / stages.length;
    const tokens = estimatedTokens * share;
    const windowOf = (name: UsageWindowName): number | undefined => {
      const perToken = ratios.percentUsedPerToken[name];
      return readsUsageWindows(engine) && perToken !== undefined ? tokens * perToken : undefined;
    };
    return {
      engine,
      tokens: Math.round(tokens),
      windows: { fiveHour: windowOf("fiveHour"), sevenDay: windowOf("sevenDay") },
      cost: ratios.dollarsPerToken === undefined ? undefined : tokens * ratios.dollarsPerToken,
    };
  });
}

/** Tokens as every token count gives them: input, output and cache writes, not cache reads. */
export function countedTokens({ input, output, cacheCreation }: StageTokens): number {
  return input + output + cacheCreation;
}

function enginesOf(stages: readonly EstimatedStage[]): readonly Engine[] {
  return [...new Set(stages.map(({ engine }) => engine))];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumOrUndefined(values: readonly (number | undefined)[]): number | undefined {
  return values.every((value) => value !== undefined) ? sum(values) : undefined;
}
