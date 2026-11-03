import { describe, expect, it } from "vitest";
import type { EngineUsage } from "../domain/usage-estimate.js";
import { StartsSinceReading } from "./starts-since-reading.js";

const READ_AT = new Date(2026, 10, 2, 10, 0);
const STARTED_AT = new Date(2026, 10, 2, 10, 5);
const READ_AGAIN_AT = new Date(2026, 10, 2, 10, 10);

function usageOn(engineId: string, fiveHour: number): EngineUsage {
  return { engineId, tokens: 1000, windows: { fiveHour, sevenDay: 1 }, cost: 0.1 };
}

describe("StartsSinceReading", () => {
  it("keeps a start's estimate on an engine until that engine is read again", () => {
    const starts = new StartsSinceReading();
    starts.record(STARTED_AT, [usageOn("work", 30), usageOn("lab", 10)]);

    starts.forgetUntil("lab", READ_AGAIN_AT);

    expect(starts.expectedOf("work", READ_AT)).toEqual({ fiveHour: 30, sevenDay: 1 });
    expect(starts.expectedOf("lab", READ_AT)).toEqual({ fiveHour: 0, sevenDay: 0 });
  });

  it("keeps what started after the reading", () => {
    const starts = new StartsSinceReading();
    starts.record(READ_AGAIN_AT, [usageOn("work", 30)]);

    starts.forgetUntil("work", STARTED_AT);

    expect(starts.expectedOf("work", STARTED_AT)).toEqual({ fiveHour: 30, sevenDay: 1 });
  });
});
