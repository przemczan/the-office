import { describe, expect, it } from "vitest";
import { contextLabel, tokensShort } from "./context-words.ts";

describe("a Thread's context label", () => {
  it("reads as the spec's examples", () => {
    expect(
      contextLabel(
        { move: "resume", reason: "cache-warm", contextTokens: 41_234, briefTokens: null },
        "Jan",
      ),
    ).toBe("Continuing · cache warm · 41k context");
    expect(
      contextLabel(
        { move: "fresh", reason: "cache-expired", contextTokens: 48_000, briefTokens: 3_100 },
        "Jan",
      ),
    ).toBe("Fresh · cache expired, 48k context · brief ~3.1k");
  });

  it("says why for every other reason", () => {
    expect(
      contextLabel(
        { move: "fresh", reason: "new-thread", contextTokens: 0, briefTokens: 420 },
        "Jan",
      ),
    ).toBe("Fresh · new Thread · brief ~420");
    expect(
      contextLabel(
        { move: "resume", reason: "session-default", contextTokens: 80_000, briefTokens: null },
        "Jan",
      ),
    ).toBe("Continuing · Jan's session default · 80k context");
    expect(
      contextLabel(
        { move: "fresh", reason: "context-full", contextTokens: 820_000, briefTokens: 2_900 },
        "Jan",
      ),
    ).toBe("Fresh · context full, Handover note written · brief ~2.9k");
    expect(
      contextLabel(
        { move: "fresh", reason: "changes-switched", contextTokens: 12_000, briefTokens: 1_200 },
        "Sam",
      ),
    ).toBe("Fresh · Allow changes switched · brief ~1.2k");
  });

  it("counts tokens in thousands from a thousand", () => {
    expect(tokensShort(999)).toBe("999");
    expect(tokensShort(1_000)).toBe("1k");
    expect(tokensShort(12_600)).toBe("13k");
    expect(tokensShort(1_240_000)).toBe("1.2M");
  });
});
