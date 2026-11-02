import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { UsageWindowsChanged, UsageWindowsRead } from "../domain/engine-events.js";
import { NO_TOKENS } from "../ports/session-events.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

function readingAt(readAt: Date): UsageWindowReading {
  return {
    fiveHour: { percentUsed: 40, resetsAt: new Date("2026-11-02T12:00:00.000Z") },
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
    const state = new UsageWindowState(events);
    const later = new Date("2026-11-02T09:05:00.000Z");

    await state.update(readingAt(new Date("2026-11-02T09:00:00.000Z")));
    await state.update(readingAt(later));

    expect(published.map((event) => event.constructor)).toEqual([
      UsageWindowsChanged,
      UsageWindowsRead,
      UsageWindowsRead,
    ]);
    expect(published.at(-1)).toMatchObject({ readAt: later });
  });

  it("gives the reading only to an engine id with windows", async () => {
    const state = new UsageWindowState(new EventBus());
    await state.update(readingAt(new Date("2026-11-02T09:00:00.000Z")));

    expect(state.of("claude-code")?.fiveHour.percentUsed).toBe(40);
    expect(state.of("openai-compatible-api")).toBeUndefined();
  });
});
