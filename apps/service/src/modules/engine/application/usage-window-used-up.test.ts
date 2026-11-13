import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowReset, UsageWindowUsedUp } from "../domain/engine-events.js";
import { NO_TOKENS, UNKNOWN_RESET_RETRY_MS } from "../ports/session-events.js";
import { UsageWindowState } from "./usage-window-state.js";

const CLAUDE_CODE = { id: "claude-code", name: "Claude Code" };
const WORK_ACCOUNT = { id: "work-account", name: "Work account" };
const NOW = new Date("2026-11-13T12:00:00.000Z");
const RESET = new Date("2026-11-13T14:00:00.000Z");

function watched() {
  const events = new EventBus();
  const usedUp: UsageWindowUsedUp[] = [];
  const reset: UsageWindowReset[] = [];
  events.subscribe(UsageWindowUsedUp, (event) => void usedUp.push(event));
  events.subscribe(UsageWindowReset, (event) => void reset.push(event));
  return { state: new UsageWindowState(events), usedUp, reset };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UsageWindowState, a used-up usage window (kept in memory only, spec 5.4)", () => {
  it("announces a refusal once per engine until its reset, and knows the engine used up till then", async () => {
    const { state, usedUp } = watched();
    const refused = { window: "five-hour", resetsAt: RESET, resetGiven: true };

    await state.refused(CLAUDE_CODE, refused, NOW);
    await state.refused(CLAUDE_CODE, refused, NOW);

    expect(usedUp).toEqual([
      expect.objectContaining({
        engineId: "claude-code",
        engineName: "Claude Code",
        window: "five-hour",
        resetsAt: RESET,
      }),
    ]);
    expect(state.usedUpUntil("claude-code", NOW)).toEqual({
      engineName: "Claude Code",
      window: "five-hour",
      until: RESET,
    });
    expect(state.usedUpUntil("work-account", NOW)).toBeUndefined();
    expect(state.usedUpUntil("claude-code", RESET)).toBeUndefined();
  });

  it("announces it again when a later refusal moves the reset on", async () => {
    const { state, usedUp } = watched();
    const later = new Date("2026-11-20T09:00:00.000Z");

    await state.refused(
      CLAUDE_CODE,
      { window: "five-hour", resetsAt: RESET, resetGiven: true },
      NOW,
    );
    await state.refused(
      CLAUDE_CODE,
      { window: "seven-day", resetsAt: later, resetGiven: true },
      NOW,
    );

    expect(usedUp.map((event) => event.window)).toEqual(["five-hour", "seven-day"]);
    expect(state.usedUpUntil("claude-code", NOW)?.until).toEqual(later);
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
    const guessed = new Date(NOW.getTime() + UNKNOWN_RESET_RETRY_MS);

    const fiveHour = await state.refused(
      CLAUDE_CODE,
      { window: "five-hour", resetsAt: guessed, resetGiven: false },
      NOW,
    );
    const unknown = await state.refused(
      WORK_ACCOUNT,
      { window: "unknown", resetsAt: guessed, resetGiven: false },
      NOW,
    );

    expect(fiveHour).toEqual({ window: "five-hour", resetsAt: RESET, resetGiven: true });
    expect(unknown.resetsAt).toEqual(guessed);
  });

  it("announces the window reset at its reset time", async () => {
    vi.useFakeTimers({ now: NOW });
    const { state, reset } = watched();

    await state.refused(CLAUDE_CODE, { window: "five-hour", resetsAt: RESET, resetGiven: true });
    await vi.advanceTimersByTimeAsync(RESET.getTime() - NOW.getTime());

    expect(reset).toEqual([
      expect.objectContaining({ engineId: "claude-code", window: "five-hour" }),
    ]);
    expect(state.usedUpUntil("claude-code")).toBeUndefined();
  });
});
