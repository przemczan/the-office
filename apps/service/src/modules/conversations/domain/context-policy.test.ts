import { describe, expect, it } from "vitest";
import { decideContext } from "./context-policy.js";
import { NOW, MINUTE, aContinuation } from "./context-policy.fixtures.js";

describe("the Context policy", () => {
  it("resumes while the cache is warm, whatever the context, offering to start fresh", () => {
    expect(decideContext(aContinuation(59, 120_000))).toEqual({
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      cacheWarmUntil: new Date(NOW.getTime() + MINUTE),
      contextTokens: 120_000,
      briefTokens: undefined,
      alternatives: [{ override: "start-fresh", tokens: 3_000 }],
    });
  });
});

describe("the moment's override", () => {
  it("never continues another person's session", () => {
    const decision = decideContext(
      aContinuation(1, 5_000, { roleKey: "reviewer", override: "continue-anyway" }),
    );

    expect(decision.move).toBe("hand-off");
  });
});
