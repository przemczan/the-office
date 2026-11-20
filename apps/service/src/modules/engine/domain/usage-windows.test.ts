import { describe, expect, it } from "vitest";
import { showsFree, type UsageWindows } from "./usage-windows.js";

function windows(fiveHour: number, sevenDay: number): UsageWindows {
  return {
    fiveHour: { percentUsed: fiveHour, resetsAt: undefined },
    sevenDay: { percentUsed: sevenDay, resetsAt: undefined },
    source: "usage-endpoint",
  };
}

describe("showsFree, whether a reading shows the engine free (spec §5.4)", () => {
  it("is free while every window is below 100%", () => {
    expect(showsFree(windows(0, 0))).toBe(true);
    expect(showsFree(windows(99, 99.9))).toBe(true);
  });

  it("is not free while any window is used up", () => {
    expect(showsFree(windows(100, 10))).toBe(false);
    expect(showsFree(windows(10, 100))).toBe(false);
  });
});
