import { ENGINE_IDS, hasUsageWindows, type EngineId } from "../../engine/index.js";
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
 * The caps on one engine id, each undefined when off. `windows` only on an engine id whose account
 * has usage windows (`hasUsageWindows`).
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
  /** Every engine id's, in the order of `ENGINE_IDS`. */
  readonly caps: readonly EngineCaps[];
}

/** An engine id's caps until saved: Window caps at 90% where there are windows, Daily caps off. */
export function defaultEngineCaps(engineId: EngineId): EngineCaps {
  return {
    engineId,
    windows: hasUsageWindows(engineId)
      ? { fiveHour: DEFAULT_WINDOW_CAP, sevenDay: DEFAULT_WINDOW_CAP }
      : undefined,
    dailyTokens: undefined,
    dailyDollars: undefined,
  };
}

export const DEFAULT_USAGE_SETTINGS: UsageSettings = {
  measures: DEFAULT_USAGE_MEASURES,
  caps: ENGINE_IDS.map(defaultEngineCaps),
};

/** Whether `caps` name every engine id, each once, and no other. */
export function namesEveryEngineId(caps: readonly Pick<EngineCaps, "engineId">[]): boolean {
  const named = new Set(caps.map(({ engineId }) => engineId));
  return (
    named.size === caps.length &&
    named.size === ENGINE_IDS.length &&
    ENGINE_IDS.every((engineId) => named.has(engineId))
  );
}

/** Every engine id's caps, those not saved at their default, in the order of `ENGINE_IDS`. */
export function everyEngineCaps(saved: readonly EngineCaps[]): readonly EngineCaps[] {
  return ENGINE_IDS.map(
    (engineId) => saved.find((caps) => caps.engineId === engineId) ?? defaultEngineCaps(engineId),
  );
}
