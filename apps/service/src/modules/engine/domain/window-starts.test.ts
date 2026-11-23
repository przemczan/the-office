import { afterEach, describe, expect, it } from "vitest";
import type { UsageWindows } from "./usage-windows.js";
import {
  MAX_WINDOW_START_TIMES,
  NO_WINDOW_START,
  WINDOW_START_AFTER_RESET_DELAY,
  WINDOW_START_WEEKLY_LIMIT_PERCENT,
  nextWindowStart,
  sortedWindowStartTimes,
  windowStartSkipReason,
  windowStartTimeProblems,
} from "./window-starts.js";

const NOW = new Date("2026-11-23T10:00:00Z");

/** A reading with the 5-hour window reset and the week well below the limit: a start goes ahead. */
const FREE: UsageWindows = {
  fiveHour: { percentUsed: 0, resetsAt: undefined },
  sevenDay: { percentUsed: 40, resetsAt: new Date("2026-11-27T09:00:00Z") },
  source: "usage-endpoint",
};

function withWeek(percentUsed: number): UsageWindows {
  return { ...FREE, sevenDay: { ...FREE.sevenDay, percentUsed } };
}

describe("windowStartSkipReason (spec §5.4.6, When it is skipped)", () => {
  it("goes ahead on a reading with the 5-hour window reset and the week below the limit", () => {
    expect(windowStartSkipReason({ reading: FREE, usedUp: false, now: NOW })).toBeUndefined();
  });

  it("goes ahead when the reading's 5-hour reset has passed", () => {
    const reading = {
      ...FREE,
      fiveHour: { percentUsed: 80, resetsAt: new Date(NOW.getTime() - 1) },
    };
    expect(windowStartSkipReason({ reading, usedUp: false, now: NOW })).toBeUndefined();
  });

  it("skips with readings-unknown when there is no reading, before every other reason", () => {
    expect(windowStartSkipReason({ reading: undefined, usedUp: true, now: NOW })).toBe(
      "readings-unknown",
    );
  });

  it("skips with engine-used-up while the engine is used up, before the reading's own reasons", () => {
    const reading: UsageWindows = {
      fiveHour: { percentUsed: 0, resetsAt: undefined, missing: true },
      sevenDay: { percentUsed: 100, resetsAt: undefined },
      source: "usage-endpoint",
    };
    expect(windowStartSkipReason({ reading, usedUp: true, now: NOW })).toBe("engine-used-up");
  });

  it("skips with no-5-hour-window when the account has none, before the week's reasons", () => {
    const reading: UsageWindows = {
      ...withWeek(100),
      fiveHour: { percentUsed: 0, resetsAt: undefined, missing: true },
    };
    expect(windowStartSkipReason({ reading, usedUp: false, now: NOW })).toBe("no-5-hour-window");
  });

  it("skips with window-running while the 5-hour reset is ahead, before the week's reasons", () => {
    const reading: UsageWindows = {
      ...withWeek(100),
      fiveHour: { percentUsed: 5, resetsAt: new Date(NOW.getTime() + 1) },
    };
    expect(windowStartSkipReason({ reading, usedUp: false, now: NOW })).toBe("window-running");
  });

  it("skips with weekly-used-up at 100% of the 7-day window", () => {
    expect(windowStartSkipReason({ reading: withWeek(100), usedUp: false, now: NOW })).toBe(
      "weekly-used-up",
    );
  });

  it("skips with weekly-nearly-used-up at exactly the weekly limit and above, not below it", () => {
    expect(WINDOW_START_WEEKLY_LIMIT_PERCENT).toBe(90);
    expect(windowStartSkipReason({ reading: withWeek(90), usedUp: false, now: NOW })).toBe(
      "weekly-nearly-used-up",
    );
    expect(windowStartSkipReason({ reading: withWeek(99.9), usedUp: false, now: NOW })).toBe(
      "weekly-nearly-used-up",
    );
    expect(
      windowStartSkipReason({ reading: withWeek(89.9), usedUp: false, now: NOW }),
    ).toBeUndefined();
  });

  it("takes no Daily cap: the judgement is the reading, the used-up state and the time only", () => {
    // A reached Daily cap doesn't skip a start (spec §5.4.6): nothing about the day's use is judged.
    const judgement = { reading: FREE, usedUp: false, now: NOW, dailyCapReached: true };
    expect(windowStartSkipReason(judgement)).toBeUndefined();
    expect(windowStartSkipReason.length).toBe(1);
  });
});

/** `hours:minutes` on the local clock, `daysAhead` days after NOW's day. */
const at = (hours: number, minutes = 0, daysAhead = 0) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + daysAhead, hours, minutes);

describe("nextWindowStart (spec §5.4.6, The next start)", () => {
  it("is none with no set times and after-reset off", () => {
    expect(nextWindowStart(NO_WINDOW_START, new Date(NOW.getTime() + 1000), NOW)).toBeUndefined();
  });

  it("is none with after-reset on but no reset known", () => {
    expect(
      nextWindowStart({ startAtTimes: [], startAfterReset: true }, undefined, NOW),
    ).toBeUndefined();
  });

  it("is the soonest set time later today, on the local clock", () => {
    const now = at(8, 30);
    expect(
      nextWindowStart(
        { startAtTimes: ["07:00", "13:15", "21:00"], startAfterReset: false },
        undefined,
        now,
      ),
    ).toEqual({ at: at(13, 15), trigger: "set-time" });
  });

  it("is tomorrow's when every set time has passed today, the time just reached included", () => {
    expect(
      nextWindowStart(
        { startAtTimes: ["07:00", "08:30"], startAfterReset: false },
        undefined,
        at(8, 30),
      ),
    ).toEqual({ at: at(7, 0, 1), trigger: "set-time" });
  });

  it("with after-reset on, is 1 minute after the 5-hour reset when that comes before a set time", () => {
    const now = at(8, 0);
    const resetsAt = at(9, 0);
    expect(WINDOW_START_AFTER_RESET_DELAY).toBe(60_000);
    expect(
      nextWindowStart({ startAtTimes: ["12:00"], startAfterReset: true }, resetsAt, now),
    ).toEqual({ at: at(9, 1), trigger: "after-reset" });
  });

  it("is the set time when it comes before the after-reset time", () => {
    expect(
      nextWindowStart({ startAtTimes: ["08:45"], startAfterReset: true }, at(9, 0), at(8, 0)),
    ).toEqual({ at: at(8, 45), trigger: "set-time" });
  });

  it("fires an after-reset start at once when the reset has already passed", () => {
    const now = at(8, 0);
    expect(nextWindowStart({ startAtTimes: [], startAfterReset: true }, at(6, 0), now)).toEqual({
      at: now,
      trigger: "after-reset",
    });
  });

  it("ignores the reset with after-reset off", () => {
    expect(
      nextWindowStart({ startAtTimes: ["12:00"], startAfterReset: false }, at(9, 0), at(8, 0)),
    ).toEqual({ at: at(12, 0), trigger: "set-time" });
  });

  describe("on the days the clocks change (Europe/Warsaw)", () => {
    const timeZone = process.env.TZ;

    afterEach(() => {
      if (timeZone === undefined) delete process.env.TZ;
      else process.env.TZ = timeZone;
    });

    it("lands a set time the clocks skip just after the change, at 03:30 local", () => {
      process.env.TZ = "Europe/Warsaw";
      // 2026-03-29: 02:00 CET jumps to 03:00 CEST at 01:00Z; 02:30 never shows on the clock.
      const now = new Date("2026-03-28T23:00:00Z"); // 00:00 local
      const next = nextWindowStart(
        { startAtTimes: ["02:30"], startAfterReset: false },
        undefined,
        now,
      );
      expect(next).toEqual({ at: new Date("2026-03-29T01:30:00Z"), trigger: "set-time" });
      expect(next?.at.getHours()).toBe(3);
      expect(next?.at.getMinutes()).toBe(30);
    });

    it("lands a set time the clocks show twice once, the next one the day after", () => {
      process.env.TZ = "Europe/Warsaw";
      // 2026-10-25: 03:00 CEST falls back to 02:00 CET at 01:00Z; 02:30 shows at 00:30Z and 01:30Z.
      const settings = { startAtTimes: ["02:30"], startAfterReset: false };
      const first = nextWindowStart(settings, undefined, new Date("2026-10-24T22:00:00Z"));
      expect(first).toEqual({ at: new Date("2026-10-25T00:30:00Z"), trigger: "set-time" });

      const after = nextWindowStart(settings, undefined, new Date("2026-10-25T00:30:00Z"));
      expect(after).toEqual({ at: new Date("2026-10-26T01:30:00Z"), trigger: "set-time" });
      expect(after?.at.getDate()).toBe(26);
      expect(after?.at.getHours()).toBe(2);
    });
  });
});

describe("windowStartTimeProblems (spec §5.4.6, Its settings)", () => {
  it("finds none in unique, well-formed times", () => {
    expect(windowStartTimeProblems(["00:00", "07:30", "23:59"])).toEqual([]);
  });

  it("refuses a time past 23:59 and one not written as HH:MM", () => {
    expect(windowStartTimeProblems(["25:00", "7:00", "07:60"])).toEqual([
      `"25:00" isn't a time of day as HH:MM, 00:00 to 23:59.`,
      `"7:00" isn't a time of day as HH:MM, 00:00 to 23:59.`,
      `"07:60" isn't a time of day as HH:MM, 00:00 to 23:59.`,
    ]);
  });

  it("refuses a time given twice", () => {
    expect(windowStartTimeProblems(["07:00", "12:00", "07:00"])).toEqual(["07:00 is set twice."]);
  });

  it("keeps at most 24 times", () => {
    const hourly = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
    expect(MAX_WINDOW_START_TIMES).toBe(24);
    expect(windowStartTimeProblems(hourly)).toEqual([]);
    expect(windowStartTimeProblems([...hourly, "12:30"])).toEqual([
      "At most 24 set times are kept.",
    ]);
  });
});

describe("sortedWindowStartTimes", () => {
  it("keeps the times unique and sorted", () => {
    expect(sortedWindowStartTimes(["21:00", "07:00", "21:00", "00:15"])).toEqual([
      "00:15",
      "07:00",
      "21:00",
    ]);
  });
});
