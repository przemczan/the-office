import type { EngineId } from "../../engine/index.js";
import { SESSION_SHAPING_DUTIES } from "./session-instructions.js";
import type { ContextOverride, ThreadSession } from "./thread.js";

/** A person's default for a Thread whose cache has cooled, from their Role card (spec §9). */
export type SessionDefault = "context-policy" | "always-start-fresh" | "prefer-to-continue";

/**
 * The three moves (spec §2.5): resume the session (its context stays), start a fresh one for the
 * same person with a Brief, or hand off to another person with a Brief.
 */
export type ContextMove = "resume" | "fresh" | "hand-off";

/** Why the move was chosen, which the Thread's label shows. */
export type ContextReason =
  /** Nobody has answered in the Thread yet. */
  | "new-thread"
  /** Someone else answers next: never their session. */
  | "another-person"
  /** The last call was within the cache's lifetime. */
  | "cache-warm"
  /** The cache has cooled, but re-caching the context costs little. */
  | "small-context"
  /** The cache has cooled and the context is large: a Brief is cheaper. */
  | "cache-expired"
  /** The cache has cooled and the person's session default decided. */
  | "session-default"
  /** The user's override for this moment. */
  | "your-choice"
  /** A Stage begins: the session it declares wins (spec §2.5). */
  | "stage-declared"
  /** The context neared its limit and the person wrote a Handover note: never resumed. */
  | "context-full"
  /** The person's Role card picks another engine than the session runs on, which can't resume it. */
  | "engine-changed"
  /** The user allowed changes in the Caretaker's Thread or switched them off: other rules apply. */
  | "changes-switched"
  /** The person holds other duties than as the session started, so other tools (spec §2.2). */
  | "duties-changed";

export interface ContextPolicySettings {
  /** How long the prompt cache stays warm after a call. */
  readonly cacheLifetimeMs: number;
  /**
   * Above this much context added since the session's first turn, a cooled Thread starts fresh
   * under the Context policy: what the engine itself takes, a fresh session pays too (spec §9).
   */
  readonly sizeThreshold: number;
  /** The share of the model's window at which The Office asks for a Handover note. */
  readonly handOverAtShare: number;
}

/**
 * Spec §2.5: an hour's cache, and 30k tokens to start with, tuned from telemetry; Settings › Office
 * limits changes the size threshold.
 */
export const DEFAULT_CONTEXT_POLICY_SETTINGS: ContextPolicySettings = {
  cacheLifetimeMs: 60 * 60 * 1000,
  sizeThreshold: 30_000,
  // Leaves room for the turn that writes the Handover note.
  handOverAtShare: 0.8,
};

/** A Thread about to take the next message. */
export interface Continuation {
  readonly now: Date;
  /** The session behind the Thread now; undefined before anyone answered in it. */
  readonly session:
    | Pick<
        ThreadSession,
        | "roleKey"
        | "engineId"
        | "lastCallAt"
        | "contextTokens"
        | "startContextTokens"
        | "full"
        | "changesAllowed"
        | "heldDuties"
      >
    | undefined;
  /** Who answers next, by the key of the Role they fill. */
  readonly roleKey: string;
  /** Theirs, from the Role card version the next session would run with. */
  readonly sessionDefault: SessionDefault;
  /** The engine that card picks; undefined when nobody fills the Role, so nobody answers. */
  readonly engineId: EngineId | undefined;
  readonly override: ContextOverride | undefined;
  /**
   * At a Stage boundary, the session the Stage declares: fresh, or continuing the previous Stage's
   * when the same person worked it. Undefined inside a Thread.
   */
  readonly declared?: "fresh" | "continue";
  /** What a Brief for a fresh session takes, estimated. */
  readonly briefTokens: number;
  /** Whether changes are allowed in the Thread now (a Caretaker's, spec §2.4); undefined is no. */
  readonly changesAllowed?: boolean;
  /** The duties the person holds now, which decide their built-in tools; undefined when unknown. */
  readonly heldDuties?: readonly string[];
}

/** What the user may choose instead, with its estimated cost in tokens. */
export interface ContextAlternative {
  readonly override: ContextOverride;
  readonly tokens: number;
}

export interface ContextDecision {
  readonly move: ContextMove;
  readonly reason: ContextReason;
  /** Whether the session's prompt cache is still warm; false without a session. */
  readonly cacheWarm: boolean;
  /** When the warm cache goes cold, which the UI counts down to; undefined while it isn't warm. */
  readonly cacheWarmUntil: Date | undefined;
  /** The session's context now; 0 without a session. */
  readonly contextTokens: number;
  /** The Brief's estimate when the move needs one. */
  readonly briefTokens: number | undefined;
  /**
   * "Start fresh" with what a Brief takes, or "Continue anyway" with the context to read back or
   * re-cache; none for a new Thread, a hand-off, a full context, a changed engine, a switch of
   * Allow changes or duties moved, which have no session to choose between.
   */
  readonly alternatives: readonly ContextAlternative[];
}

/**
 * The Context policy (spec §2.5, §9): what the next message of a Thread does to its session. A
 * pure function of the moment, so a fake clock tests it.
 */
export function decideContext(
  continuation: Continuation,
  settings: ContextPolicySettings = DEFAULT_CONTEXT_POLICY_SETTINGS,
): ContextDecision {
  const { session, briefTokens } = continuation;
  if (!session) {
    return { ...withoutSession(briefTokens), move: "fresh", reason: "new-thread" };
  }
  if (session.roleKey !== continuation.roleKey) {
    return { ...withoutSession(briefTokens), move: "hand-off", reason: "another-person" };
  }
  if (session.full) {
    return {
      ...withoutSession(briefTokens),
      contextTokens: session.contextTokens,
      move: "fresh",
      reason: "context-full",
    };
  }
  if (continuation.engineId !== undefined && session.engineId !== continuation.engineId) {
    return {
      ...withoutSession(briefTokens),
      contextTokens: session.contextTokens,
      move: "fresh",
      reason: "engine-changed",
    };
  }
  if (session.changesAllowed !== (continuation.changesAllowed ?? false)) {
    return {
      ...withoutSession(briefTokens),
      contextTokens: session.contextTokens,
      move: "fresh",
      reason: "changes-switched",
    };
  }
  if (dutiesChanged(session.heldDuties, continuation.heldDuties)) {
    return {
      ...withoutSession(briefTokens),
      contextTokens: session.contextTokens,
      move: "fresh",
      reason: "duties-changed",
    };
  }
  const cacheWarmUntil = warmUntil(session.lastCallAt, continuation.now, settings);
  const cacheWarm = cacheWarmUntil !== undefined;
  const { move, reason } = choose(continuation, addedTokens(session), cacheWarm, settings);
  return {
    move,
    reason,
    cacheWarm,
    cacheWarmUntil,
    contextTokens: session.contextTokens,
    briefTokens: move === "fresh" ? briefTokens : undefined,
    alternatives: [
      move === "resume"
        ? { override: "start-fresh", tokens: briefTokens }
        : { override: "continue-anyway", tokens: session.contextTokens },
    ],
  };
}

function choose(
  { override, sessionDefault, declared }: Continuation,
  addedContextTokens: number,
  cacheWarm: boolean,
  settings: ContextPolicySettings,
): { readonly move: "resume" | "fresh"; readonly reason: ContextReason } {
  if (declared)
    return { move: declared === "continue" ? "resume" : "fresh", reason: "stage-declared" };
  if (override) {
    return { move: override === "start-fresh" ? "fresh" : "resume", reason: "your-choice" };
  }
  if (cacheWarm) return { move: "resume", reason: "cache-warm" };
  switch (sessionDefault) {
    case "always-start-fresh":
      return { move: "fresh", reason: "session-default" };
    case "prefer-to-continue":
      return { move: "resume", reason: "session-default" };
    case "context-policy":
      return addedContextTokens > settings.sizeThreshold
        ? { move: "fresh", reason: "cache-expired" }
        : { move: "resume", reason: "small-context" };
  }
}

/** What the conversation added to the context since the session's first turn. */
function addedTokens({
  contextTokens,
  startContextTokens,
}: Pick<ThreadSession, "contextTokens" | "startContextTokens">): number {
  return Math.max(0, contextTokens - (startContextTokens ?? contextTokens));
}

/** When the prompt cache of a call ended at `lastCallAt` goes cold; undefined once it has. */
function warmUntil(
  lastCallAt: Date | undefined,
  now: Date,
  { cacheLifetimeMs }: ContextPolicySettings,
): Date | undefined {
  if (lastCallAt === undefined) return undefined;
  const until = lastCallAt.getTime() + cacheLifetimeMs;
  return now.getTime() < until ? new Date(until) : undefined;
}

/**
 * Whether the person holds other duties than as the session started, among those its tools and
 * instructions depend on; unknown is not.
 */
function dutiesChanged(
  started: readonly string[] | undefined,
  now: readonly string[] | undefined,
): boolean {
  if (started === undefined || now === undefined) return false;
  return SESSION_SHAPING_DUTIES.some((duty) => started.includes(duty) !== now.includes(duty));
}

function withoutSession(briefTokens: number): Omit<ContextDecision, "move" | "reason"> {
  return {
    cacheWarm: false,
    cacheWarmUntil: undefined,
    contextTokens: 0,
    briefTokens,
    alternatives: [],
  };
}
