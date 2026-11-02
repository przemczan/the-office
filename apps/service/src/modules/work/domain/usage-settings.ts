import { hasUsageWindows, type Engine, type EngineId } from "../../engine/index.js";
import {
  DEFAULT_USAGE_MEASURES,
  type UsageMeasure,
  type UsageWindowName,
} from "./usage-estimate.js";

/*
 * Settings › Office limits' Usage (spec §2.2): the measures Usage estimates are given in, and the
 * caps per engine id a Start is weighed against while a cap's measure is ticked.
 */

/** A Window cap until the user changes it: the % of the window a Start may bring it to. */
export const DEFAULT_WINDOW_CAP = 90;

/** A Window cap on each window, in % of it; undefined is off. */
export type WindowCaps = Readonly<Record<UsageWindowName, number | undefined>>;

/**
 * The caps on one engine, each undefined when off. `windows` only on an engine whose account has
 * usage windows (`hasUsageWindows`).
 */
export interface EngineCaps {
  readonly engineId: EngineId;
  readonly windows: WindowCaps | undefined;
  readonly dailyTokens: number | undefined;
  readonly dailyDollars: number | undefined;
}

export interface UsageSettings {
  /** None ticked turns Usage estimates off. */
  readonly measures: readonly UsageMeasure[];
  /** Every engine's, in the engines' order; as kept, only those saved. */
  readonly caps: readonly EngineCaps[];
}

/** An engine's caps until saved: Window caps at 90% where there are windows, Daily caps off. */
export function defaultEngineCaps(engine: Engine): EngineCaps {
  return {
    engineId: engine.id,
    windows: hasUsageWindows(engine)
      ? { fiveHour: DEFAULT_WINDOW_CAP, sevenDay: DEFAULT_WINDOW_CAP }
      : undefined,
    dailyTokens: undefined,
    dailyDollars: undefined,
  };
}

/** The settings until saved: the default measures, and no caps saved. */
export const DEFAULT_USAGE_SETTINGS: UsageSettings = {
  measures: DEFAULT_USAGE_MEASURES,
  caps: [],
};

/** Whether `caps` name every engine, each once, and no other. */
export function namesEveryEngine(
  caps: readonly Pick<EngineCaps, "engineId">[],
  engines: readonly Engine[],
): boolean {
  const named = new Set(caps.map(({ engineId }) => engineId));
  return (
    named.size === caps.length &&
    named.size === engines.length &&
    engines.every(({ id }) => named.has(id))
  );
}

/**
 * Every engine's caps, in their order: as saved, Window caps only where there are windows, or at
 * their default. A removed engine's are left out.
 */
export function everyEngineCaps(
  saved: readonly EngineCaps[],
  engines: readonly Engine[],
): readonly EngineCaps[] {
  return engines.map((engine) => {
    const caps = saved.find(({ engineId }) => engineId === engine.id);
    if (caps === undefined) return defaultEngineCaps(engine);
    return { ...caps, windows: hasUsageWindows(engine) ? caps.windows : undefined };
  });
}
