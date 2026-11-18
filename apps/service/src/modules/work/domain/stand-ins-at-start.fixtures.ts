import { FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
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

/**
 * A Task spending 30% of Work's 5-hour window on Opus, Work at `workUsed`% and Personal, its
 * Stand-in Engine with the same ratios, at `personalUsed`%.
 */
export function onWorkWithPersonal(
  workUsed: number,
  personalUsed: number,
): { readonly usage: UsageAtStart; readonly standIns: StandInsAtStart } {
  return {
    usage: {
      now: NOW,
      measures: ["fiveHourWindow"],
      estimate: [estimateOn("work", 30)],
      windows: [fiveHourAt("work", workUsed)],
      daily: [],
      engineNames: new Map(WORK_AND_PERSONAL.map(({ id, name }) => [id, name] as const)),
      usedUp: [],
    },
    standIns: {
      engines: WORK_AND_PERSONAL,
      order: ["personal"],
      modelsOn: new Map([["work", ["claude-opus-5-5"]]]),
      standIns: [
        {
          engineId: "personal",
          windows: fiveHourAt("personal", personalUsed),
          daily: undefined,
          usedUp: undefined,
          windowRatios: { fiveHour: 0.03, sevenDay: undefined },
        },
      ],
    },
  };
}
