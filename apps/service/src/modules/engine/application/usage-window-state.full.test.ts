import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { UsageWindowsChanged, UsageWindowsRead } from "../domain/engine-events.js";
import { NO_TOKENS } from "../ports/session-events.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

const CLAUDE_CODE = { id: "claude-code", name: "Claude Code" };
const WORK_ACCOUNT = { id: "work-account", name: "Work account" };

function readingAt(readAt: Date, fiveHourPercent = 40): UsageWindowReading {
  return {
    fiveHour: { percentUsed: fiveHourPercent, resetsAt: new Date("2026-11-02T12:00:00.000Z") },
    sevenDay: { percentUsed: 10, resetsAt: undefined },
    source: "rate-limit-headers",
    readAt,
    officeTokensSoFar: NO_TOKENS,
  };
}

describe("UsageWindowState", () => {
  it("announces every reading, and a change only when the windows differ", async () => {
    const events = new EventBus();
    const published: DomainEvent[] = [];
    events.subscribe(UsageWindowsChanged, (event) => void published.push(event));
    events.subscribe(UsageWindowsRead, (event) => void published.push(event));
    const state = new UsageWindowState(events, new ManualSchedule());
    const later = new Date("2026-11-02T09:05:00.000Z");

    await state.update(CLAUDE_CODE, readingAt(new Date("2026-11-02T09:00:00.000Z")));
    await state.update(CLAUDE_CODE, readingAt(later));

    expect(published.map((event) => event.constructor)).toEqual([
      UsageWindowsChanged,
      UsageWindowsRead,
      UsageWindowsRead,
    ]);
    expect(published[0]).toMatchObject({ engineId: "claude-code", engineName: "Claude Code" });
    expect(published.at(-1)).toMatchObject({ readAt: later });
  });

  it("keeps each engine's reading apart, a change on one announced as that engine's", async () => {
    const events = new EventBus();
    const changes: UsageWindowsChanged[] = [];
    events.subscribe(UsageWindowsChanged, (event) => void changes.push(event));
    const state = new UsageWindowState(events, new ManualSchedule());
    const at = new Date("2026-11-02T09:00:00.000Z");

    await state.update(CLAUDE_CODE, readingAt(at, 90));
    await state.update(WORK_ACCOUNT, readingAt(at, 10));
    await state.update(CLAUDE_CODE, readingAt(at, 90));

    expect(changes.map(({ engineId }) => engineId)).toEqual(["claude-code", "work-account"]);
    expect([...state.readingsByEngine.keys()]).toEqual(["claude-code", "work-account"]);
    expect(state.of("work-account")?.fiveHour.percentUsed).toBe(10);
  });

  it("gives the reading only to an engine id with windows", async () => {
    const state = new UsageWindowState(new EventBus(), new ManualSchedule());
    await state.update(CLAUDE_CODE, readingAt(new Date("2026-11-02T09:00:00.000Z")));

    expect(state.of("claude-code")?.fiveHour.percentUsed).toBe(40);
    expect(state.of("openai-compatible-api")).toBeUndefined();
  });
});
