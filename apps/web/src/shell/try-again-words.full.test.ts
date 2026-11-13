import { describe, expect, it } from "vitest";
import { tryAgainWords } from "./try-again-words.ts";

const NOW = new Date(2026, 10, 13, 14, 0, 0);

function inMs(milliseconds: number): string {
  return new Date(NOW.getTime() + milliseconds).toISOString();
}

describe("when to try again", () => {
  it("counts a short wait in seconds, rounding up", () => {
    expect(tryAgainWords(inMs(15_200), NOW)).toBe("Try again in 16 seconds.");
    expect(tryAgainWords(inMs(900), NOW)).toBe("Try again in 1 second.");
    expect(tryAgainWords(inMs(60_000), NOW)).toBe("Try again in 60 seconds.");
  });

  it("names the time of a longer one, with its day when not today", () => {
    expect(tryAgainWords(inMs(15 * 60_000), NOW)).toBe("Try again at 14:15.");
    expect(tryAgainWords(inMs(24 * 3_600_000), NOW)).toBe("Try again at 14 Nov, 14:00.");
  });

  it("says nothing once the time has come", () => {
    expect(tryAgainWords(inMs(0), NOW)).toBeUndefined();
    expect(tryAgainWords(inMs(-5_000), NOW)).toBeUndefined();
  });
});
