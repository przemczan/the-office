import { describe, expect, it } from "vitest";
import {
  capWaits,
  exceededWindowCaps,
  nextCapRelease,
  withStartedSinceReading,
  type ExceededCap,
  type UsageAtStart,
  type WindowsAtStart,
} from "./cap-waits.js";
import type { EngineUsage } from "./usage-estimate.js";

const NOW = new Date(2026, 10, 2, 9, 0);
const IN_THREE_HOURS = new Date(2026, 10, 2, 12, 0);
const IN_HALF_AN_HOUR = new Date(2026, 10, 2, 9, 30);

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
  };
}

describe("exceededWindowCaps", () => {
  it("passes the cap with the reading, the Tasks started since it and this Task's estimate", () => {
    const exceeded = exceededWindowCaps(usage(claudeCode(80, IN_THREE_HOURS, 6), estimateOf(5)));

    expect(exceeded).toEqual([
      {
        words:
          "The Claude Code engines' 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 5% of this Task. It resets at 12:00.",
        resetsAt: IN_THREE_HOURS,
      },
    ]);
  });

  it("holds nothing at the cap itself", () => {
    expect(exceededWindowCaps(usage(claudeCode(80, IN_THREE_HOURS, 5), estimateOf(5)))).toEqual([]);
  });

  it("weighs the use alone for a Task with no estimate of the window", () => {
    const below = usage(claudeCode(85, IN_THREE_HOURS, 20), estimateOf(undefined));
    const past = usage(claudeCode(91, IN_THREE_HOURS), undefined);

    expect(exceededWindowCaps(below)).toEqual([]);
    expect(exceededWindowCaps(past).map(({ words }) => words)).toEqual([
      "The Claude Code engines' 5-hour window would pass its 90% cap: 91% used, and this Task has no estimate. It resets at 12:00.",
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
      "The Claude Code engines' 7-day window would pass its 95% cap: 99% used, 0% expected of the Tasks started since it was read and 1% of this Task. It resets on Thu 5 Nov at 14:30.",
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

  it("lets it start anyway when every cap it would pass resets within the prompt cache's hour", () => {
    const inAnHour = new Date(2026, 10, 2, 10, 0);

    expect(capWaits([cap(IN_HALF_AN_HOUR), cap(inAnHour)], NOW)).toEqual({
      waits: [],
      resetsAt: undefined,
    });
    expect(capWaits([], NOW).waits).toEqual([]);
  });
});

describe("withStartedSinceReading", () => {
  it("adds a Task started on the same reading to what its engine id's windows expect", () => {
    const added = withStartedSinceReading(usage(claudeCode(80, IN_THREE_HOURS, 6), undefined), [
      estimateOf(5),
      { ...estimateOf(7), engineId: "openai-compatible-api" },
    ]);

    expect(added.windows[0]?.startedSinceReading).toEqual({ fiveHour: 11, sevenDay: 1 });
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
