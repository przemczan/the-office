import { describe, expect, it } from "vitest";
import { durationWords } from "./time.ts";

describe("durationWords", () => {
  it("rounds to minutes, and hours past an hour", () => {
    expect([20_000, 120_000, 4_200_000, 7_200_000].map(durationWords)).toEqual([
      "<1 min",
      "2 min",
      "1h 10 min",
      "2h",
    ]);
  });
});
