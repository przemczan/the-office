import { describe, expect, it } from "vitest";
import { clockOf, dayAndClockOf } from "./time.ts";
import {
  engineSwitchedWords,
  pausedByUsageWindowWords,
  usageWindowUsedUpWords,
} from "./usage-window-words.ts";
import { taskStateWords } from "./work/work-words.ts";

const NOW = new Date("2026-11-13T12:00:00");
const LATER_TODAY = new Date("2026-11-13T14:00:00").toISOString();
const NEXT_WEEK = new Date("2026-11-20T09:30:00").toISOString();

describe("a Task paused by the usage window (spec 2.1)", () => {
  it("reads why and when it resumes, in local time, with the day when it isn't today", () => {
    expect(pausedByUsageWindowWords(LATER_TODAY, NOW)).toBe(
      `Usage window used up · resumes ${clockOf(LATER_TODAY)}`,
    );
    expect(pausedByUsageWindowWords(NEXT_WEEK, NOW)).toBe(
      `Usage window used up · resumes ${dayAndClockOf(NEXT_WEEK, NOW)}`,
    );
  });

  it("is what the Paused badge says, while the alarm's and the user's Pause read as before", () => {
    const resumesAt = LATER_TODAY;
    expect(taskStateWords("paused", { pausedBy: "usage-window", resumesAt, now: NOW })).toBe(
      `Usage window used up · resumes ${clockOf(LATER_TODAY)}`,
    );
    expect(taskStateWords("paused", { pausedBy: "alarm", resumesAt: null })).toBe(
      "Paused by the alarm",
    );
    expect(taskStateWords("paused", { pausedBy: null })).toBe("Paused");
    expect(taskStateWords("in-progress", { pausedBy: "usage-window", resumesAt })).toBe(
      "In progress",
    );
  });
});

describe("a Thread's line for a turn refused for a used-up usage window (spec 2.4)", () => {
  it("names the engine, the window and its reset in local time", () => {
    expect(
      usageWindowUsedUpWords(
        { engineName: "Claude Code", window: "five-hour", resetsAt: LATER_TODAY },
        NOW,
      ),
    ).toBe(`Claude Code's 5-hour window is used up until ${clockOf(LATER_TODAY)}`);
  });

  it("words each window the engine names, and a new one by its own name", () => {
    const words = (window: string) =>
      usageWindowUsedUpWords({ engineName: "Work", window, resetsAt: NEXT_WEEK }, NOW);

    expect(words("seven-day")).toContain("Work's 7-day window is used up until");
    expect(words("seven-day-opus")).toContain("Opus weekly window");
    expect(words("seven-day-sonnet")).toContain("Sonnet weekly window");
    expect(words("overage")).toContain("Work's extra usage is used up");
    expect(words("unknown")).toContain("Work's usage window is used up");
    expect(words("thirty_day_fable")).toContain("thirty_day_fable window");
    expect(words("seven-day")).toContain(dayAndClockOf(NEXT_WEEK, NOW));
  });
});

describe("a Thread's line for a session that went on on a Stand-in Engine (spec 5.4)", () => {
  const switched = { fromName: "Claude Code", toName: "Claude Code 2", window: "five-hour" };

  it("says the Stage went on in a Stage Thread", () => {
    expect(engineSwitchedWords({ ...switched, resetsAt: LATER_TODAY }, NOW)).toBe(
      `Claude Code's 5-hour window was used up until ${clockOf(LATER_TODAY)}, so the Stage went on on Claude Code 2`,
    );
  });

  it("names the person who went on in a person's Thread", () => {
    expect(
      engineSwitchedWords({ ...switched, resetsAt: LATER_TODAY, personName: "Pam" }, NOW),
    ).toBe(
      `Claude Code's 5-hour window was used up until ${clockOf(LATER_TODAY)}, so Pam went on on Claude Code 2`,
    );
  });
});
