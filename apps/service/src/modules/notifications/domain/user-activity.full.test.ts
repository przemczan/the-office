import { describe, expect, it } from "vitest";
import { AWAY_AFTER_MS, recordActivity } from "./user-activity.js";

const NINE = new Date("2026-10-27T09:00:00Z");

function after(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

describe("recordActivity", () => {
  it("takes the first sight as where Since you left begins", () => {
    expect(recordActivity(undefined, NINE)).toEqual({ lastActiveAt: NINE, leftAt: NINE });
  });

  it("keeps where Since you left begins through a visit", () => {
    const first = recordActivity(undefined, NINE);
    const later = after(NINE, AWAY_AFTER_MS - 1);

    expect(recordActivity(first, later)).toEqual({ lastActiveAt: later, leftAt: NINE });
  });

  it("moves it to the last activity before an absence when the user comes back", () => {
    const visit = { lastActiveAt: after(NINE, 60_000), leftAt: NINE };
    const back = after(visit.lastActiveAt, AWAY_AFTER_MS);

    expect(recordActivity(visit, back)).toEqual({
      lastActiveAt: back,
      leftAt: visit.lastActiveAt,
    });
  });

  it("ignores activity no later than the last", () => {
    const visit = { lastActiveAt: NINE, leftAt: NINE };

    expect(recordActivity(visit, after(NINE, -1))).toBe(visit);
  });
});
