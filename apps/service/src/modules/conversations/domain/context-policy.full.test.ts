import { describe, expect, it } from "vitest";
import {
  decideContext,
  DEFAULT_CONTEXT_POLICY_SETTINGS,
  type Continuation,
} from "./context-policy.js";
import { NOW, MINUTE, aContinuation } from "./context-policy.fixtures.js";

/** A Thread cooled for 90 minutes whose session took 33k at its first turn. */
function cooledFrom33k(contextTokens: number): Continuation {
  return aContinuation(90, contextTokens, {
    session: {
      roleKey: "planner",
      engineId: "claude-code",
      lastCallAt: new Date(NOW.getTime() - 90 * MINUTE),
      contextTokens,
      startContextTokens: 33_000,
      full: false,
      changesAllowed: false,
    },
  });
}

describe("the Context policy", () => {
  it("lets the Stage's declared session win at a Stage boundary, but never across a Role change", () => {
    const warm = aContinuation(5, 40_000, { declared: "fresh" });
    const cold = cooledFrom33k(120_000);

    expect(decideContext(warm)).toMatchObject({ move: "fresh", reason: "stage-declared" });
    expect(decideContext({ ...cold, declared: "continue" })).toMatchObject({
      move: "resume",
      reason: "stage-declared",
    });
    expect(decideContext({ ...cold, declared: "continue", roleKey: "developer" })).toMatchObject({
      move: "hand-off",
      reason: "another-person",
    });
  });

  it("says when a warm cache goes cold, and nothing once it has or with no session", () => {
    const settings = { ...DEFAULT_CONTEXT_POLICY_SETTINGS, cacheLifetimeMs: 10 * MINUTE };

    expect(decideContext(aContinuation(4, 1_000), settings).cacheWarmUntil).toEqual(
      new Date(NOW.getTime() + 6 * MINUTE),
    );
    expect(decideContext(aContinuation(10, 1_000), settings).cacheWarmUntil).toBeUndefined();
    expect(
      decideContext({ ...aContinuation(1, 1_000), session: undefined }).cacheWarmUntil,
    ).toBeUndefined();
  });

  it("resumes a cooled Thread with a small context", () => {
    const decision = decideContext(aContinuation(60, 30_000));

    expect(decision).toMatchObject({ move: "resume", reason: "small-context", cacheWarm: false });
  });

  it("starts a cooled Thread with a large context fresh, offering to continue at the re-cache cost", () => {
    expect(decideContext(aContinuation(61, 48_000))).toEqual({
      move: "fresh",
      reason: "cache-expired",
      cacheWarm: false,
      contextTokens: 48_000,
      briefTokens: 3_000,
      alternatives: [{ override: "continue-anyway", tokens: 48_000 }],
    });
  });

  it("counts a session with no call yet as cooled", () => {
    const decision = decideContext(
      aContinuation(0, 48_000, {
        session: {
          roleKey: "planner",
          engineId: "claude-code",
          lastCallAt: undefined,
          contextTokens: 48_000,
          startContextTokens: 0,
          full: false,
          changesAllowed: false,
        },
      }),
    );

    expect(decision).toMatchObject({ move: "fresh", reason: "cache-expired", cacheWarm: false });
  });

  it("counts only what the conversation added since the session's first turn", () => {
    expect(decideContext(cooledFrom33k(63_000))).toMatchObject({
      move: "resume",
      reason: "small-context",
      contextTokens: 63_000,
    });
    expect(decideContext(cooledFrom33k(63_001))).toMatchObject({
      move: "fresh",
      reason: "cache-expired",
    });
  });

  it("takes the threshold from the settings", () => {
    const settings = { ...DEFAULT_CONTEXT_POLICY_SETTINGS, sizeThreshold: 10_000 };

    expect(decideContext(aContinuation(90, 12_000), settings).move).toBe("fresh");
  });

  it("starts a new Thread fresh with a Brief, with nothing to choose instead", () => {
    expect(decideContext(aContinuation(0, 0, { session: undefined }))).toEqual({
      move: "fresh",
      reason: "new-thread",
      cacheWarm: false,
      contextTokens: 0,
      briefTokens: 3_000,
      alternatives: [],
    });
  });

  it("hands off to another person with a Brief, even while the cache is warm", () => {
    expect(decideContext(aContinuation(1, 5_000, { roleKey: "reviewer" }))).toEqual({
      move: "hand-off",
      reason: "another-person",
      cacheWarm: false,
      contextTokens: 0,
      briefTokens: 3_000,
      alternatives: [],
    });
  });
});

describe("a session whose context filled up", () => {
  it("starts fresh with nothing to choose instead, even while the cache is warm", () => {
    const decision = decideContext(
      aContinuation(1, 820_000, {
        session: {
          roleKey: "planner",
          engineId: "claude-code",
          lastCallAt: new Date(NOW.getTime() - MINUTE),
          contextTokens: 820_000,
          startContextTokens: 33_000,
          full: true,
          changesAllowed: false,
        },
        override: "continue-anyway",
      }),
    );

    expect(decision).toEqual({
      move: "fresh",
      reason: "context-full",
      cacheWarm: false,
      contextTokens: 820_000,
      briefTokens: 3_000,
      alternatives: [],
    });
  });

  it("starts fresh when the person's card picks another engine, whatever would resume", () => {
    const onAnotherAccount = { engineId: "second-account" } as const;
    const resuming = [
      aContinuation(5, 40_000, onAnotherAccount),
      aContinuation(90, 40_000, { ...onAnotherAccount, override: "continue-anyway" }),
      aContinuation(5, 40_000, { ...onAnotherAccount, declared: "continue" }),
    ];

    for (const continuation of resuming) {
      expect(decideContext(continuation)).toEqual({
        move: "fresh",
        reason: "engine-changed",
        cacheWarm: false,
        contextTokens: 40_000,
        briefTokens: 3_000,
        alternatives: [],
      });
    }
  });

  it("resumes a session moved to a Stand-in Engine on the engine it stands in for", () => {
    const moved = aContinuation(5, 40_000);
    const onStandIn = {
      ...moved,
      session: moved.session && {
        ...moved.session,
        engineId: "home-account",
        standInFor: { engineId: "claude-code", engineName: "Claude Code", reason: "used up" },
      },
    };

    expect(decideContext(onStandIn)).toMatchObject({ move: "resume", reason: "cache-warm" });
    expect(decideContext({ ...onStandIn, engineId: "home-account" })).toMatchObject({
      move: "resume",
    });
    expect(decideContext({ ...onStandIn, engineId: "second-account" })).toMatchObject({
      move: "fresh",
      reason: "engine-changed",
    });
  });

  it("starts fresh once changes are allowed in the Thread or switched off, whatever would resume", () => {
    const allowed = aContinuation(5, 40_000, { changesAllowed: true });
    const base = aContinuation(5, 40_000);
    const switchedOff = {
      ...base,
      session: base.session && { ...base.session, changesAllowed: true },
    };

    for (const continuation of [
      allowed,
      { ...allowed, override: "continue-anyway" as const },
      switchedOff,
    ]) {
      expect(decideContext(continuation)).toEqual({
        move: "fresh",
        reason: "changes-switched",
        cacheWarm: false,
        contextTokens: 40_000,
        briefTokens: 3_000,
        alternatives: [],
      });
    }
    expect(decideContext({ ...switchedOff, changesAllowed: true })).toMatchObject({
      move: "resume",
    });
  });

  describe("the duties the person holds", () => {
    const base = aContinuation(5, 40_000);
    function startedHolding(
      started: readonly string[] | undefined,
      now: readonly string[] | undefined,
    ): Continuation {
      return {
        ...base,
        session: base.session && { ...base.session, heldDuties: started },
        heldDuties: now,
      };
    }

    it("start fresh once those deciding its tools differ from the session's, whatever would resume", () => {
      for (const continuation of [
        startedHolding(["plans"], ["plans", "onboards-projects"]),
        startedHolding(["plans", "onboards-projects"], ["plans"]),
        startedHolding(["onboards-projects"], []),
        startedHolding([], ["default-person-to-talk-to"]),
        startedHolding(["plans"], ["shapes-initiatives"]),
        {
          ...startedHolding(["plans"], ["shapes-initiatives"]),
          override: "continue-anyway" as const,
        },
      ]) {
        expect(decideContext(continuation)).toEqual({
          move: "fresh",
          reason: "duties-changed",
          cacheWarm: false,
          contextTokens: 40_000,
          briefTokens: 3_000,
          alternatives: [],
        });
      }
    });

    it("resume as before when they are the same, in any order, differ only in duties no tool depends on, or either side is unknown", () => {
      for (const continuation of [
        startedHolding(["plans", "reviews"], ["reviews", "plans"]),
        startedHolding(["plans"], []),
        startedHolding(["shapes-initiatives"], ["shapes-initiatives", "reviews", "implements"]),
        startedHolding([], []),
        startedHolding(undefined, ["plans"]),
        startedHolding(["plans"], undefined),
      ]) {
        expect(decideContext(continuation)).toMatchObject({
          move: "resume",
          reason: "cache-warm",
        });
      }
    });
  });

  it("leaves the engine out when nobody fills the Role any more", () => {
    expect(decideContext(aContinuation(5, 40_000, { engineId: undefined }))).toMatchObject({
      move: "resume",
      reason: "cache-warm",
    });
  });
});

describe("a person's session default", () => {
  it("decides only once the cache has cooled", () => {
    for (const sessionDefault of ["always-start-fresh", "prefer-to-continue"] as const) {
      expect(decideContext(aContinuation(10, 48_000, { sessionDefault }))).toMatchObject({
        move: "resume",
        reason: "cache-warm",
      });
    }
  });

  it("starts fresh for Always start fresh, even with a small context", () => {
    const decision = decideContext(
      aContinuation(90, 2_000, { sessionDefault: "always-start-fresh" }),
    );

    expect(decision).toMatchObject({ move: "fresh", reason: "session-default" });
    expect(decision.alternatives).toEqual([{ override: "continue-anyway", tokens: 2_000 }]);
  });

  it("continues for Prefer to continue, even with a large context", () => {
    const decision = decideContext(
      aContinuation(90, 80_000, { sessionDefault: "prefer-to-continue" }),
    );

    expect(decision).toMatchObject({ move: "resume", reason: "session-default" });
    expect(decision.alternatives).toEqual([{ override: "start-fresh", tokens: 3_000 }]);
  });
});

describe("the moment's override", () => {
  it("starts fresh while the cache is warm when the user chooses it", () => {
    const decision = decideContext(aContinuation(5, 41_000, { override: "start-fresh" }));

    expect(decision).toMatchObject({ move: "fresh", reason: "your-choice", briefTokens: 3_000 });
    expect(decision.alternatives).toEqual([{ override: "continue-anyway", tokens: 41_000 }]);
  });

  it("continues a cooled, large Thread anyway, over the session default too", () => {
    const decision = decideContext(
      aContinuation(90, 48_000, {
        override: "continue-anyway",
        sessionDefault: "always-start-fresh",
      }),
    );

    expect(decision).toMatchObject({ move: "resume", reason: "your-choice", cacheWarm: false });
  });
});
