import { describe, expect, it } from "vitest";
import {
  cacheStateAt,
  CONTEXT_CHOICES,
  contextChoiceOf,
  contextChoiceWords,
  contextLabel,
  overrideOf,
  tokensShort,
} from "./context-words.ts";

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

describe("cacheStateAt", () => {
  const now = new Date("2026-11-05T10:00:00.000Z");

  it("counts the minutes left of a warm cache, rounding up", () => {
    const context = { reason: "cache-warm", cacheWarmUntil: "2026-11-05T10:40:30.000Z" } as const;
    expect(cacheStateAt(context, now)).toEqual({ kind: "warm", minutesLeft: 41 });
  });

  it("never counts more than the cache's hour, on a clock behind the call that warmed it", () => {
    const context = { reason: "cache-warm", cacheWarmUntil: "2026-11-05T11:00:30.000Z" } as const;
    expect(cacheStateAt(context, now)).toEqual({ kind: "warm", minutesLeft: 60 });
  });

  it("goes cold when the clock passes it, before the Thread is read again", () => {
    const context = { reason: "cache-warm", cacheWarmUntil: "2026-11-05T10:00:00.000Z" } as const;
    expect(cacheStateAt(context, now)).toEqual({ kind: "cold" });
  });

  it("is cold for a session whose cache has cooled", () => {
    expect(cacheStateAt({ reason: "cache-expired", cacheWarmUntil: null }, now)).toEqual({
      kind: "cold",
    });
  });

  it("has nothing to mark without a session", () => {
    expect(cacheStateAt({ reason: "new-thread", cacheWarmUntil: null }, now)).toEqual({
      kind: "none",
    });
  });
});

describe("contextChoiceWords", () => {
  const warm = { kind: "warm", minutesLeft: 41 } as const;
  const cold = { kind: "cold" } as const;
  const resuming: Parameters<typeof contextChoiceWords>[0] = {
    move: "resume",
    reason: "cache-warm",
    contextTokens: 41_000,
    briefTokens: null,
    alternatives: [{ override: "start-fresh", tokens: 3_100 }],
    override: null,
  };
  const startingFresh: Parameters<typeof contextChoiceWords>[0] = {
    move: "fresh",
    reason: "cache-expired",
    contextTokens: 48_000,
    briefTokens: 3_100,
    alternatives: [{ override: "continue-anyway", tokens: 48_000 }],
    override: null,
  };

  it("says what each choice does with a warm cache, and its cost", () => {
    expect(contextChoiceWords(resuming, "auto", warm, "Jan")).toBe(
      "Continues · cache warm, 41 min left · 41k context",
    );
    expect(contextChoiceWords(resuming, "continue", warm, "Jan")).toBe(
      "Continues · cache warm, 41 min left · 41k context",
    );
    expect(contextChoiceWords(resuming, "fresh", warm, "Jan")).toBe(
      "Starts fresh · Brief ~3.1k tokens",
    );
  });

  it("says what each choice does with a cold cache, and its cost", () => {
    expect(contextChoiceWords(startingFresh, "auto", cold, "Jan")).toBe(
      "Starts fresh · cache cold, 48k context · Brief ~3.1k tokens",
    );
    expect(contextChoiceWords(startingFresh, "continue", cold, "Jan")).toBe(
      "Continues anyway · cache cold, so the 48k context is read again in full",
    );
    expect(
      contextChoiceWords(
        { ...resuming, reason: "small-context", contextTokens: 12_000 },
        "auto",
        cold,
        "Jan",
      ),
    ).toBe("Continues · cache cold, but only 12k context");
  });

  it("names the person's session default when it decided", () => {
    expect(
      contextChoiceWords({ ...startingFresh, reason: "session-default" }, "auto", cold, "Jan"),
    ).toBe("Starts fresh · Jan's session default · Brief ~3.1k tokens");
  });

  it("promises nothing for Auto while the user's choice hides the policy's", () => {
    expect(
      contextChoiceWords(
        { ...startingFresh, reason: "your-choice", override: "start-fresh" },
        "auto",
        cold,
        "Jan",
      ),
    ).toBe("Back to the Context policy's choice");
  });
});

describe("the choice and the override", () => {
  it("are the same thing in two words", () => {
    for (const { value } of CONTEXT_CHOICES) {
      expect(contextChoiceOf(overrideOf(value))).toBe(value);
    }
  });
});
