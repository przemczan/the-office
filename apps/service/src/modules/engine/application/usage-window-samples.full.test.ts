import { describe, expect, it } from "vitest";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import type { ReadingSource } from "../domain/usage-windows.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import type { UsageWindowReading } from "./usage-window-state.js";

const RESETS_AT = new Date("2100-01-01T00:00:00Z");

function aReading(
  fiveHour: number,
  officeInput: number,
  source: ReadingSource = "rate-limit-headers",
): UsageWindowReading {
  return {
    fiveHour: { percentUsed: fiveHour, resetsAt: RESETS_AT },
    sevenDay: { percentUsed: 10, resetsAt: RESETS_AT },
    source,
    readAt: new Date(),
    officeTokensSoFar: { input: officeInput, output: 0, cacheRead: 50_000, cacheCreation: 0 },
  };
}

describe("UsageWindowSamples", () => {
  it("pairs each reading with the last of its own source, an endpoint reading between left apart", async () => {
    const samples = new UsageWindowSamples(new UsageWindowSamplesForTests());

    await samples.add("claude-code", aReading(10, 1_000));
    await samples.add("claude-code", aReading(30, 1_500, "usage-endpoint"));
    await samples.add("claude-code", aReading(11, 3_000));
    await samples.add("claude-code", aReading(11, 5_000));

    expect(await samples.ratios("claude-code")).toEqual({ fiveHour: 1 / 4_000, sevenDay: 0 });
  });

  it("keeps the earlier reading as the start while no turn has ended since", async () => {
    const samples = new UsageWindowSamples(new UsageWindowSamplesForTests());

    await samples.add("claude-code", aReading(10, 1_000));
    await samples.add("claude-code", aReading(11, 1_000));
    await samples.add("claude-code", aReading(12, 3_000));

    expect(await samples.ratios("claude-code")).toEqual({ fiveHour: 2 / 2_000, sevenDay: 0 });
  });

  it("pairs no reading of an unknown source", async () => {
    const samples = new UsageWindowSamples(new UsageWindowSamplesForTests());

    await samples.add("claude-code", { ...aReading(10, 1_000), source: undefined });
    await samples.add("claude-code", { ...aReading(11, 3_000), source: undefined });

    expect(await samples.ratios("claude-code")).toEqual({
      fiveHour: undefined,
      sevenDay: undefined,
    });
  });
});
