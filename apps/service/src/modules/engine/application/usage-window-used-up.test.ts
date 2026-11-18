import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { UsageWindowReset, UsageWindowsRead, UsageWindowUsedUp } from "../domain/engine-events.js";
import { NO_TOKENS, UNKNOWN_RESET_RETRY_MS } from "../ports/session-events.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

const CLAUDE_CODE = { id: "claude-code", name: "Claude Code" };
const WORK_ACCOUNT = { id: "work-account", name: "Work account" };
const NOW = new Date("2026-11-13T12:00:00.000Z");
const RESET = new Date("2026-11-13T14:00:00.000Z");
const GUESSED = new Date(NOW.getTime() + UNKNOWN_RESET_RETRY_MS);

function watched() {
  const events = new EventBus();
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  const usedUp: UsageWindowUsedUp[] = [];
  const reset: UsageWindowReset[] = [];
  events.subscribe(UsageWindowUsedUp, (event) => void usedUp.push(event));
  events.subscribe(UsageWindowReset, (event) => void reset.push(event));
  return { state: new UsageWindowState(events, schedule), events, schedule, usedUp, reset };
}

describe("UsageWindowState, a used-up usage window (kept in memory only, spec 5.4)", () => {
  it("announces a refusal once per engine until its reset, and knows the engine used up till then", async () => {
    const { state, schedule, usedUp } = watched();
    const refused = { window: "five-hour", resetsAt: RESET, resetGiven: true };

    await state.refused(CLAUDE_CODE, refused);
    await state.refused(CLAUDE_CODE, refused);

    expect(usedUp).toEqual([
      expect.objectContaining({
        engineId: "claude-code",
        engineName: "Claude Code",
        window: "five-hour",
        resetsAt: RESET,
      }),
    ]);
    expect(state.usedUpUntil("claude-code")).toEqual({
      engineName: "Claude Code",
      window: "five-hour",
      until: RESET,
    });
    expect(state.usedUpUntil("work-account")).toBeUndefined();
    schedule.setTime(RESET);
    expect(state.usedUpUntil("claude-code")).toBeUndefined();
  });

  it("announces it again when a later refusal moves the reset on", async () => {
    const { state, usedUp } = watched();
    const later = new Date("2026-11-20T09:00:00.000Z");

    await state.refused(CLAUDE_CODE, { window: "five-hour", resetsAt: RESET, resetGiven: true });
    await state.refused(CLAUDE_CODE, { window: "seven-day", resetsAt: later, resetGiven: true });

    expect(usedUp.map((event) => event.window)).toEqual(["five-hour", "seven-day"]);
    expect(state.usedUpUntil("claude-code")?.until).toEqual(later);
  });

  it("takes the latest reading's reset of that window when the engine gave none", async () => {
    const { state } = watched();
    await state.update(CLAUDE_CODE, {
      fiveHour: { percentUsed: 100, resetsAt: RESET },
      sevenDay: { percentUsed: 40, resetsAt: undefined },
      source: "usage-endpoint",
      readAt: NOW,
      officeTokensSoFar: NO_TOKENS,
    });

    const fiveHour = await state.refused(CLAUDE_CODE, {
      window: "five-hour",
      resetsAt: GUESSED,
      resetGiven: false,
    });
    const unknown = await state.refused(WORK_ACCOUNT, {
      window: "unknown",
      resetsAt: GUESSED,
      resetGiven: false,
    });

    expect(fiveHour).toEqual({ window: "five-hour", resetsAt: RESET, resetGiven: true });
    expect(unknown.resetsAt).toEqual(GUESSED);
  });

  it("keeps the known reset for a later refusal that gives none, rather than the hour's guess", async () => {
    const { state, usedUp } = watched();
    await state.refused(CLAUDE_CODE, { window: "seven-day", resetsAt: RESET, resetGiven: true });

    const again = await state.refused(CLAUDE_CODE, {
      window: "unknown",
      resetsAt: GUESSED,
      resetGiven: false,
    });

    expect(again).toEqual({ window: "seven-day", resetsAt: RESET, resetGiven: true });
    expect(usedUp).toHaveLength(1);
  });

  it("announces the window reset at its reset time, on The Office's clock", async () => {
    const { state, schedule, reset } = watched();

    await state.refused(CLAUDE_CODE, { window: "five-hour", resetsAt: RESET, resetGiven: true });
    await schedule.advanceTo(RESET);

    expect(reset).toEqual([
      expect.objectContaining({ engineId: "claude-code", window: "five-hour" }),
    ]);
    expect(state.usedUpUntil("claude-code")).toBeUndefined();
  });
});

function readingAt(readAt: Date, fiveHourPercent: number): UsageWindowReading {
  return {
    fiveHour: { percentUsed: fiveHourPercent, resetsAt: RESET },
    sevenDay: { percentUsed: 40, resetsAt: undefined },
    source: "usage-endpoint",
    readAt,
    officeTokensSoFar: NO_TOKENS,
  };
}

function withReadings() {
  const watching = watched();
  const read: UsageWindowsRead[] = [];
  watching.events.subscribe(UsageWindowsRead, (event) => void read.push(event));
  return { ...watching, read };
}

describe("UsageWindowState, a reading that shows a used-up engine free (spec 5.4)", () => {
  const FIVE_MINUTES_ON = new Date(NOW.getTime() + 5 * 60 * 1000);

  it("resets the window at once on a free reading taken after it was used up", async () => {
    const { state, schedule, reset, read } = withReadings();
    await state.refused(CLAUDE_CODE, { window: "five-hour", resetsAt: RESET, resetGiven: true });

    schedule.setTime(FIVE_MINUTES_ON);
    await state.update(CLAUDE_CODE, readingAt(FIVE_MINUTES_ON, 12));

    expect(reset).toEqual([
      expect.objectContaining({ engineId: "claude-code", window: "five-hour" }),
    ]);
    expect(state.usedUpUntil("claude-code")).toBeUndefined();
    expect(read.map((event) => event.free)).toEqual([true]);
    await schedule.advanceTo(RESET);
    expect(reset).toHaveLength(1);
  });

  it("keeps the window used up on a reading that isn't free, or one taken before it was used up", async () => {
    const { state, schedule, reset, read } = withReadings();
    schedule.setTime(FIVE_MINUTES_ON);
    await state.refused(CLAUDE_CODE, { window: "five-hour", resetsAt: RESET, resetGiven: true });

    await state.update(CLAUDE_CODE, readingAt(NOW, 12));
    await state.update(CLAUDE_CODE, readingAt(FIVE_MINUTES_ON, 100));

    expect(reset).toEqual([]);
    expect(state.usedUpUntil("claude-code")?.until).toEqual(RESET);
    expect(read.map((event) => event.free)).toEqual([true, false]);
  });

  it("holds the engine not free until the reset of a refusal its free reading didn't show", async () => {
    const { state, schedule, reset, read } = withReadings();
    await state.update(CLAUDE_CODE, readingAt(NOW, 12));
    await state.refused(CLAUDE_CODE, { window: "seven-day", resetsAt: RESET, resetGiven: true });

    schedule.setTime(FIVE_MINUTES_ON);
    await state.update(CLAUDE_CODE, readingAt(FIVE_MINUTES_ON, 12));

    expect(read.map((event) => event.free)).toEqual([true, false]);
    expect(reset).toEqual([]);
    expect(state.usedUpUntil("claude-code")?.until).toEqual(RESET);

    await schedule.advanceTo(RESET);
    await state.update(CLAUDE_CODE, readingAt(RESET, 12));
    expect(read.map((event) => event.free)).toEqual([true, false, true]);
  });
});
