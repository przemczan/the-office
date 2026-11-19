import { describe, expect, it } from "vitest";
import { codexUsageWindows } from "./codex-usage-windows.js";

const FIVE_HOUR_RESET = Date.parse("2026-11-17T15:00:00Z") / 1000;
const SEVEN_DAY_RESET = Date.parse("2026-11-21T00:00:00Z") / 1000;

describe("a ChatGPT account's usage windows from Codex", () => {
  it("reads the 5-hour and the 7-day window, each with its reset", () => {
    expect(
      codexUsageWindows(
        {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: FIVE_HOUR_RESET },
          secondary: { usedPercent: 30, windowDurationMins: 10_080, resetsAt: SEVEN_DAY_RESET },
        },
        "usage-endpoint",
      ),
    ).toEqual({
      fiveHour: { percentUsed: 12, resetsAt: new Date("2026-11-17T15:00:00Z") },
      sevenDay: { percentUsed: 30, resetsAt: new Date("2026-11-21T00:00:00Z") },
      source: "usage-endpoint",
    });
  });

  it("tells the windows apart by their length, whichever slot each is in", () => {
    expect(
      codexUsageWindows(
        {
          primary: { usedPercent: 30, windowDurationMins: 10_080, resetsAt: SEVEN_DAY_RESET },
          secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: FIVE_HOUR_RESET },
        },
        "rate-limit-headers",
      ),
    ).toEqual({
      fiveHour: { percentUsed: 12, resetsAt: new Date(FIVE_HOUR_RESET * 1000) },
      sevenDay: { percentUsed: 30, resetsAt: new Date(SEVEN_DAY_RESET * 1000) },
      source: "rate-limit-headers",
    });
  });

  it("reads a window missing from the snapshot as not begun", () => {
    expect(
      codexUsageWindows(
        {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: FIVE_HOUR_RESET },
          secondary: null,
        },
        "usage-endpoint",
      ),
    ).toEqual({
      fiveHour: { percentUsed: 12, resetsAt: new Date(FIVE_HOUR_RESET * 1000) },
      sevenDay: { percentUsed: 0, resetsAt: undefined },
      source: "usage-endpoint",
    });
  });

  it("reads nothing when a window is of another length, as ChatGPT Free's 30 days", () => {
    expect(
      codexUsageWindows(
        { primary: { usedPercent: 12, windowDurationMins: 43_200, resetsAt: SEVEN_DAY_RESET } },
        "usage-endpoint",
      ),
    ).toBeUndefined();
  });

  it("keeps a percentage between 0 and 100", () => {
    expect(
      codexUsageWindows(
        {
          primary: { usedPercent: 104, windowDurationMins: 300 },
          secondary: { usedPercent: -1, windowDurationMins: 10_080 },
        },
        "usage-endpoint",
      ),
    ).toEqual({
      fiveHour: { percentUsed: 100, resetsAt: undefined },
      sevenDay: { percentUsed: 0, resetsAt: undefined },
      source: "usage-endpoint",
    });
  });
});
