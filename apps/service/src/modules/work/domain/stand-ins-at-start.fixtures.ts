import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
import type { UsageAtStart, WindowsAtStart } from "./cap-waits.js";
import type { StandInsAtStart } from "./stand-ins-at-start.js";
import type { EngineUsage } from "./usage-estimate.js";

/** The Work engine, which the cascade picks, and Personal, its Stand-in Engine. */
export const WORK_AND_PERSONAL = [
  { ...FIRST_CLAUDE_CODE_ENGINE, id: "work", name: "Work" },
  { ...FIRST_CLAUDE_CODE_ENGINE, id: "personal", name: "Personal" },
] as const;

const NOW = new Date("2026-10-29T09:00:00.000Z");
const RESETS_AT = new Date("2026-10-29T12:00:00.000Z");

/** An engine's 5-hour window with an 80% cap, `percentUsed` of it used. */
export function fiveHourAt(engineId: string, percentUsed: number): WindowsAtStart {
  return {
    engineId,
    caps: { fiveHour: 80, sevenDay: undefined },
    reading: {
      readAt: new Date("2026-10-29T08:50:00.000Z"),
      fiveHour: { percentUsed, resetsAt: RESETS_AT },
      sevenDay: { percentUsed: 0, resetsAt: undefined },
    },
    startedSinceReading: { fiveHour: 0, sevenDay: 0 },
  };
}

/** A Task's estimate of 1,000 tokens, `fiveHour`% of the engine's 5-hour window. */
export function estimateOn(engineId: string, fiveHour: number): EngineUsage {
  return { engineId, tokens: 1000, windows: { fiveHour, sevenDay: undefined }, cost: undefined };
}

/** Lab, a Codex engine: a Stand-in Engine of another engine type. */
export const LAB: Engine = {
  kind: "codex",
  id: "lab",
  name: "Lab",
  defaultModel: "gpt-5.5",
  defaultEffort: null,
  apiKey: null,
};

const ENGINES: readonly Engine[] = [...WORK_AND_PERSONAL, LAB];

/**
 * A Task spending 30% of Work's 5-hour window, Work at `workUsed`% and Personal, its Stand-in
 * Engine with the same ratios, at `personalUsed`%.
 */
export function onWorkWithPersonal(
  workUsed: number,
  personalUsed: number,
): { readonly usage: UsageAtStart; readonly standIns: StandInsAtStart } {
  return onWorkWithStandIns(workUsed, [["personal", personalUsed]]);
}

/**
 * As `onWorkWithPersonal`, with `listed` the Stand-in Engines (Personal or Lab, each at its own %
 * used), the list that applies in that order unless `fields` gives another.
 */
export function onWorkWithStandIns(
  workUsed: number,
  listed: readonly (readonly [engineId: string, percentUsed: number])[],
  fields: Partial<StandInsAtStart> = {},
): { readonly usage: UsageAtStart; readonly standIns: StandInsAtStart } {
  return {
    usage: {
      now: NOW,
      measures: ["fiveHourWindow"],
      estimate: [estimateOn("work", 30)],
      windows: [fiveHourAt("work", workUsed)],
      daily: [],
      engineNames: new Map(ENGINES.map(({ id, name }) => [id, name] as const)),
      usedUp: [],
    },
    standIns: {
      engines: ENGINES,
      order: listed.map(([engineId]) => engineId),
      cascadeEngines: ["work"],
      standIns: listed.map(([engineId, percentUsed]) => ({
        engineId,
        windows: fiveHourAt(engineId, percentUsed),
        daily: undefined,
        usedUp: undefined,
        windowRatios: { fiveHour: 0.03, sevenDay: undefined },
      })),
      ...fields,
    },
  };
}
