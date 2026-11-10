import { describe, expect, it } from "vitest";
import {
  capWaits,
  exceededDailyCaps,
  exceededWindowCaps,
  type DailyCapsAtStart,
  type ExceededCap,
  type UsageAtStart,
  type WindowsAtStart,
} from "./cap-waits.js";
import type { EngineUsage } from "./usage-estimate.js";

const NOW = new Date(2026, 10, 2, 9, 0);
const IN_THREE_HOURS = new Date(2026, 10, 2, 12, 0);
const IN_HALF_AN_HOUR = new Date(2026, 10, 2, 9, 30);
const ENGINE_NAMES = new Map([
  ["claude-code", "Claude Code"],
  ["lab", "Lab"],
]);

function estimateOf(fiveHour: number | undefined): EngineUsage {
  return { engineId: "claude-code", tokens: 1000, windows: { fiveHour, sevenDay: 1 }, cost: 0.1 };
}

function claudeCode(
  percentUsed: number,
  resetsAt: Date | undefined,
  startedSinceReading = 0,
): WindowsAtStart {
  return {
    engineId: "claude-code",
    caps: { fiveHour: 90, sevenDay: undefined },
    reading: {
      readAt: new Date(2026, 10, 2, 8, 50),
      fiveHour: { percentUsed, resetsAt },
      sevenDay: { percentUsed: 99, resetsAt: new Date(2026, 10, 5, 14, 30) },
    },
    startedSinceReading: { fiveHour: startedSinceReading, sevenDay: 0 },
  };
}

function usage(windows: WindowsAtStart, estimate: EngineUsage | undefined): UsageAtStart {
  return {
    now: NOW,
    measures: ["tokens", "fiveHourWindow", "sevenDayWindow"],
    estimate: estimate ? [estimate] : [],
    windows: [windows],
    daily: [],
    engineNames: ENGINE_NAMES,
  };
}

describe("exceededWindowCaps", () => {
  it("passes the cap with the reading, the Tasks started since it and this Task's estimate", () => {
    const exceeded = exceededWindowCaps(usage(claudeCode(80, IN_THREE_HOURS, 6), estimateOf(5)));

    expect(exceeded).toEqual([
      {
        words:
          "The Claude Code engine's 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 5% of this Task. It resets at 12:00.",
        resetsAt: IN_THREE_HOURS,
      },
    ]);
  });
});

function cap(resetsAt: Date): ExceededCap {
  return { words: `Resets ${resetsAt.toISOString()}.`, resetsAt };
}

describe("capWaits", () => {
  it("holds the Start with every cap it would pass, until the last of them resets", () => {
    expect(capWaits([cap(IN_HALF_AN_HOUR), cap(IN_THREE_HOURS)], NOW)).toEqual({
      waits: [
        `Resets ${IN_HALF_AN_HOUR.toISOString()}.`,
        `Resets ${IN_THREE_HOURS.toISOString()}.`,
      ],
      resetsAt: IN_THREE_HOURS,
    });
  });
});

const MIDNIGHT = new Date(2026, 10, 3);

function dailyCaps(
  caps: DailyCapsAtStart["caps"],
  today: number,
  inProgress: number,
  engineId: DailyCapsAtStart["engineId"] = "claude-code",
): DailyCapsAtStart {
  return {
    engineId,
    caps,
    today: { tokens: today, dollars: today / 1000 },
    inProgress: { tokens: inProgress, dollars: inProgress / 1000 },
  };
}

function dailyUsage(daily: DailyCapsAtStart, estimate: EngineUsage | undefined): UsageAtStart {
  return {
    now: NOW,
    measures: ["tokens", "cost"],
    estimate: estimate ? [estimate] : [],
    windows: [],
    daily: [daily],
    engineNames: ENGINE_NAMES,
  };
}

describe("exceededDailyCaps", () => {
  const tokensCap = { tokens: 10_000, dollars: undefined };

  it("passes the cap with today's use, what is left of the Tasks in progress and this Task's", () => {
    const exceeded = exceededDailyCaps(dailyUsage(dailyCaps(tokensCap, 6000, 3500), estimateOf(5)));

    expect(exceeded).toEqual([
      {
        words:
          "The Claude Code engine's Daily cap of 10,000 tokens would be passed: 6,000 tokens used today, 3,500 tokens left of the estimates of the Tasks in progress and 1,000 tokens of this Task. It resets at midnight.",
        resetsAt: MIDNIGHT,
      },
    ]);
  });
});
