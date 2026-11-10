import { describe, expect, it } from "vitest";
import {
  bytesWords,
  coresWords,
  cpuUseWords,
  loadAverageWords,
  loadLevel,
  percentWords,
  shareOf,
  speedWords,
  uptimeWords,
} from "./workstation-words.ts";

describe("workstation words", () => {
  it("rounds a use to whole percent", () => {
    expect(percentWords(23.4)).toBe("23%");
    expect(percentWords(99.6)).toBe("100%");
  });

  it("says Measuring… before the first CPU measure, not 0%", () => {
    expect(cpuUseWords(null)).toBe("Measuring…");
    expect(cpuUseWords({ percent: 7.2, perCore: [7.2] })).toBe("7%");
  });

  it("counts cores", () => {
    expect(coresWords(1)).toBe("1 core");
    expect(coresWords(16)).toBe("16 cores");
  });

  it("gives bytes as GB to one decimal place", () => {
    expect(bytesWords(16 * 1024 ** 3)).toBe("16.0 GB");
    expect(bytesWords(200 * 1024 ** 2)).toBe("0.2 GB");
  });

  it("gives a clock speed in GHz, or nothing where it is unknown", () => {
    expect(speedWords(3200)).toBe("3.2 GHz");
    expect(speedWords(0)).toBeUndefined();
  });

  it("gives the load average over 1, 5 and 15 minutes", () => {
    expect(loadAverageWords({ oneMinute: 1.5, fiveMinutes: 1.2, fifteenMinutes: 0.981 })).toBe(
      "1.50 · 1.20 · 0.98",
    );
  });

  it("gives the uptime in its two largest units", () => {
    expect(uptimeWords(3 * 86_400 + 4 * 3600 + 59)).toBe("3d 4h");
    expect(uptimeWords(2 * 3600 + 5 * 60)).toBe("2h 5m");
    expect(uptimeWords(12 * 60 + 30)).toBe("12m");
  });

  it("gives a share of a total for a meter, 0 without a total", () => {
    expect(shareOf(4, 16)).toBe(25);
    expect(shareOf(4, 0)).toBe(0);
  });

  it("is calm below 60%, busy from 60% and high from 85%", () => {
    expect(loadLevel(0)).toBe("calm");
    expect(loadLevel(59.9)).toBe("calm");
    expect(loadLevel(60)).toBe("busy");
    expect(loadLevel(84.9)).toBe("busy");
    expect(loadLevel(85)).toBe("high");
    expect(loadLevel(100)).toBe("high");
  });
});
