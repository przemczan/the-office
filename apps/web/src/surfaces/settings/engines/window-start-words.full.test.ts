import type { WindowStartRecord, WindowStartSkipReason } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  lastWords,
  nextStartWords,
  nextWholeHourIn,
  timesInWords,
  WINDOW_START_SKIP_REASON_WORDS,
} from "./window-start-words.ts";

// Monday 23 Nov 2026, 15:30 in Warsaw (UTC+1).
const NOW = new Date("2026-11-23T14:30:00.000Z");
const WARSAW = "Europe/Warsaw";

function skipped(reason: WindowStartSkipReason): WindowStartRecord {
  return {
    at: "2026-11-23T16:00:00.000Z",
    outcome: "skipped",
    reason,
    error: null,
    trigger: "set-time",
    fiveHourResetsAt: null,
  };
}

describe("A Window start's words", () => {
  it.each([
    ["readings-unknown", "usage windows unknown"],
    ["engine-used-up", "engine used up"],
    ["no-5-hour-window", "no 5-hour window"],
    ["window-running", "5-hour window already running"],
    ["weekly-used-up", "weekly window used up"],
    ["weekly-nearly-used-up", "weekly window nearly used up"],
  ] as const)("says a skip for %s with its reason", (reason, words) => {
    expect(WINDOW_START_SKIP_REASON_WORDS[reason]).toBe(words);
    expect(lastWords(skipped(reason), WARSAW, NOW)).toBe(`Last: skipped 17:00 · ${words}`);
  });

  it("says a start by its time on the service's clock", () => {
    expect(
      lastWords({ ...skipped("window-running"), outcome: "started", reason: null }, WARSAW, NOW),
    ).toBe("Last: started 17:00");
  });

  it("says a failure with its error", () => {
    expect(
      lastWords(
        {
          ...skipped("window-running"),
          outcome: "failed",
          reason: null,
          error: "The engine isn't signed in.",
        },
        WARSAW,
        NOW,
      ),
    ).toBe("Last: failed 17:00 · The engine isn't signed in.");
  });

  it("says nothing before the first start or skip, or while no start is set", () => {
    expect(lastWords(null, WARSAW, NOW)).toBeUndefined();
    expect(nextStartWords(null, WARSAW, NOW)).toBeUndefined();
  });

  it("gives the next start today by its time, and on another day with its day", () => {
    expect(nextStartWords("2026-11-23T16:00:00.000Z", WARSAW, NOW)).toBe("Next start 17:00");
    expect(nextStartWords("2026-11-24T06:00:00.000Z", WARSAW, NOW)).toBe(
      "Next start Tue 24 Nov 07:00",
    );
  });

  it("follows the service's time zone, whatever day it is in the browser's", () => {
    // 23:30 on the 23rd in UTC is already the 24th in Tokyo.
    const lateNow = new Date("2026-11-23T23:30:00.000Z");

    expect(nextStartWords("2026-11-24T00:00:00.000Z", "Asia/Tokyo", lateNow)).toBe(
      "Next start 09:00",
    );
    expect(nextStartWords("2026-11-24T00:00:00.000Z", "UTC", lateNow)).toBe(
      "Next start Tue 24 Nov 00:00",
    );
  });

  it("says which time zone the set times follow", () => {
    expect(timesInWords(WARSAW)).toBe("Times in Europe/Warsaw");
  });

  it("offers the next whole hour on the service's clock as the first set time", () => {
    expect(nextWholeHourIn(WARSAW, NOW)).toBe("16:00");
    expect(nextWholeHourIn("UTC", new Date("2026-11-23T23:30:00.000Z"))).toBe("00:00");
  });
});
