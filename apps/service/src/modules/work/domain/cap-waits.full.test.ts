import { describe, expect, it } from "vitest";
import {
  capWaits,
  exceededCaps,
  exceededDailyCaps,
  exceededWindowCaps,
  leftOfEstimate,
  nextCapRelease,
  nextMidnight,
  withStarted,
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
  it("holds nothing at the cap itself", () => {
    expect(exceededWindowCaps(usage(claudeCode(80, IN_THREE_HOURS, 5), estimateOf(5)))).toEqual([]);
  });

  it("weighs the use and the Tasks started since alone for a Task with no estimate of it", () => {
    const below = usage(claudeCode(85, IN_THREE_HOURS, 5), estimateOf(undefined));
    const past = usage(claudeCode(85, IN_THREE_HOURS, 6), undefined);

    expect(exceededWindowCaps(below)).toEqual([]);
    expect(exceededWindowCaps(past).map(({ words }) => words)).toEqual([
      "The Claude Code engine's 5-hour window would pass its 90% cap: 85% used, 6% expected of the Tasks started since it was read, and this Task has no estimate. It resets at 12:00.",
    ]);
  });

  it("counts a window with no reading, not begun or whose reset has passed as unused", () => {
    const unread = { ...claudeCode(99, IN_THREE_HOURS), reading: undefined };
    const reset = new Date(2026, 10, 2, 8, 59);

    expect(exceededWindowCaps(usage(unread, estimateOf(50)))).toEqual([]);
    expect(exceededWindowCaps(usage(claudeCode(99, undefined), estimateOf(50)))).toEqual([]);
    expect(exceededWindowCaps(usage(claudeCode(99, reset), estimateOf(50)))).toEqual([]);
  });

  it("weighs only a ticked measure's cap that is on, the reset on another day by its date", () => {
    const sevenDayOn: WindowsAtStart = {
      ...claudeCode(10, IN_THREE_HOURS),
      caps: { fiveHour: 90, sevenDay: 95 },
    };
    const fiveHourUnticked: UsageAtStart = {
      ...usage(sevenDayOn, estimateOf(5)),
      measures: ["sevenDayWindow"],
    };

    expect(exceededWindowCaps(usage(claudeCode(10, IN_THREE_HOURS), estimateOf(5)))).toEqual([]);
    expect(exceededWindowCaps(fiveHourUnticked).map(({ words }) => words)).toEqual([
      "The Claude Code engine's 7-day window would pass its 95% cap: 99% used, 0% expected of the Tasks started since it was read and 1% of this Task. It resets on Thu 5 Nov at 14:30.",
    ]);
  });
});

function cap(resetsAt: Date): ExceededCap {
  return { words: `Resets ${resetsAt.toISOString()}.`, short: "Cap", resetsAt };
}

describe("capWaits", () => {
  it("lets it start anyway when every cap it would pass resets within the prompt cache's hour", () => {
    const inAnHour = new Date(2026, 10, 2, 10, 0);

    expect(capWaits([cap(IN_HALF_AN_HOUR), cap(inAnHour)], NOW)).toEqual({
      waits: [],
      resetsAt: undefined,
    });
    expect(capWaits([], NOW).waits).toEqual([]);
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

  it("names the engine whose cap it is by its name", () => {
    const onLab = dailyCaps(tokensCap, 9500, 0, "lab");
    const exceeded = exceededDailyCaps(dailyUsage(onLab, { ...estimateOf(5), engineId: "lab" }));

    expect(exceeded.map(({ words }) => words)).toEqual([
      expect.stringMatching(/^The Lab engine's Daily cap of 10,000 tokens would be passed/),
    ]);
  });

  it("holds nothing at the cap itself, or with no cap set", () => {
    const off = { tokens: undefined, dollars: undefined };

    expect(exceededDailyCaps(dailyUsage(dailyCaps(tokensCap, 6000, 3000), estimateOf(5)))).toEqual(
      [],
    );
    expect(exceededDailyCaps(dailyUsage(dailyCaps(off, 60_000, 0), estimateOf(5)))).toEqual([]);
  });

  it("weighs the use and the Tasks in progress alone for a Task with no estimate or no cost", () => {
    const dollarsCap = { tokens: undefined, dollars: 9.5 };
    const noCost = { ...estimateOf(5), cost: undefined };

    expect(exceededDailyCaps(dailyUsage(dailyCaps(tokensCap, 6000, 4000), undefined))).toEqual([]);
    expect(
      exceededDailyCaps(dailyUsage(dailyCaps(tokensCap, 6000, 4001), undefined)).map(
        ({ words }) => words,
      ),
    ).toEqual([
      "The Claude Code engine's Daily cap of 10,000 tokens would be passed: 6,000 tokens used today, 4,001 tokens left of the estimates of the Tasks in progress, and this Task has no estimate. It resets at midnight.",
    ]);
    expect(exceededDailyCaps(dailyUsage(dailyCaps(dollarsCap, 6000, 4000), noCost))).toEqual([
      expect.objectContaining({
        words:
          "The Claude Code engine's Daily cap of $9.50 would be passed: $6.00 used today, $4.00 left of the estimates of the Tasks in progress, and this Task has no cost. It resets at midnight.",
        short: "Daily cap ($9.50) · resets at midnight",
      }),
    ]);
  });

  it("weighs a cap only while its measure is ticked", () => {
    const both = { tokens: 1000, dollars: 1 };
    const tokensOnly: UsageAtStart = {
      ...dailyUsage(dailyCaps(both, 6000, 0), estimateOf(5)),
      measures: ["tokens"],
    };
    const noneTicked: UsageAtStart = { ...tokensOnly, measures: ["fiveHourWindow"] };

    expect(exceededDailyCaps(tokensOnly).map(({ words }) => words)).toEqual([
      expect.stringContaining("Daily cap of 1,000 tokens"),
    ]);
    expect(exceededDailyCaps(noneTicked)).toEqual([]);
  });

  it("lets a Start within the hour before midnight go anyway, as a window's reset does", () => {
    const lateEvening: UsageAtStart = {
      ...dailyUsage(dailyCaps(tokensCap, 9500, 0), estimateOf(5)),
      measures: ["tokens", "fiveHourWindow"],
      windows: [claudeCode(85, new Date(2026, 10, 2, 23, 40), 6)],
    };
    const atEleven = { ...lateEvening, now: new Date(2026, 10, 2, 23, 0) };
    const atTen = { ...lateEvening, now: new Date(2026, 10, 2, 22, 0) };

    expect(exceededCaps(atEleven)).toHaveLength(2);
    expect(capWaits(exceededCaps(atEleven), atEleven.now).waits).toEqual([]);
    expect(capWaits(exceededCaps(atTen), atTen.now).resetsAt).toEqual(MIDNIGHT);
  });
});

describe("nextMidnight", () => {
  it("is the next local midnight, from any time of today", () => {
    expect(nextMidnight(NOW)).toEqual(MIDNIGHT);
    expect(nextMidnight(new Date(2026, 10, 2))).toEqual(MIDNIGHT);
    expect(nextMidnight(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2027, 0, 1));
  });
});

describe("leftOfEstimate", () => {
  it("leaves the estimate less the tokens used so far, its dollars in the same share", () => {
    expect(leftOfEstimate(estimateOf(5), 500)).toEqual({ tokens: 500, dollars: 0.05 });
    expect(leftOfEstimate(estimateOf(5), 1500)).toEqual({ tokens: 0, dollars: 0 });
    expect(leftOfEstimate({ ...estimateOf(5), cost: undefined }, 0)).toEqual({
      tokens: 1000,
      dollars: 0,
    });
  });
});

describe("withStarted", () => {
  it("adds a Task started in the same release to its engine id's windows and Tasks in progress", () => {
    const before: UsageAtStart = {
      ...usage(claudeCode(80, IN_THREE_HOURS, 6), undefined),
      daily: [
        dailyCaps({ tokens: 10_000, dollars: undefined }, 6000, 500),
        dailyCaps({ tokens: 10_000, dollars: undefined }, 0, 0, "openai-compatible-api"),
      ],
    };
    const added = withStarted(before, [
      estimateOf(5),
      { ...estimateOf(7), engineId: "openai-compatible-api", tokens: 300, cost: undefined },
    ]);

    expect(added.windows[0]?.startedSinceReading).toEqual({ fiveHour: 11, sevenDay: 1 });
    expect(added.daily.map(({ inProgress }) => inProgress)).toEqual([
      { tokens: 1500, dollars: 0.6 },
      { tokens: 300, dollars: 0 },
    ]);
  });
});

describe("nextCapRelease", () => {
  it("releases an hour before the earliest reset still to come, then at it", () => {
    const later = new Date(2026, 10, 2, 15, 0);

    expect(nextCapRelease([later, IN_THREE_HOURS], NOW)).toEqual(new Date(2026, 10, 2, 11, 0));
    expect(nextCapRelease([IN_HALF_AN_HOUR], NOW)).toEqual(IN_HALF_AN_HOUR);
    expect(nextCapRelease([new Date(2026, 10, 2, 8, 0)], NOW)).toBeUndefined();
    expect(nextCapRelease([], NOW)).toBeUndefined();
  });
});
