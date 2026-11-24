import { describe, expect, it } from "vitest";
import { modelsListedWords } from "./engine-model-words.ts";

describe("when an engine's models were listed", () => {
  const now = new Date(2026, 10, 24, 15, 0);

  it("says the time today, and the day and time before", () => {
    expect(modelsListedWords(new Date(2026, 10, 24, 14, 2).toISOString(), now)).toBe(
      "Models listed at 14:02",
    );
    expect(modelsListedWords(new Date(2026, 9, 25, 14, 2).toISOString(), now)).toBe(
      "Models listed 25 Oct, 14:02",
    );
  });

  it("says the built-in list stands in until the engine answers", () => {
    expect(modelsListedWords(null, now)).toBe(
      "Models: the built-in list, until the engine answers.",
    );
  });
});
