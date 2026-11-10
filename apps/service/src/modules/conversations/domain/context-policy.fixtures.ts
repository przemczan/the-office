import { type Continuation } from "./context-policy.js";

// What context-policy.test.ts and context-policy.full.test.ts share.

export const NOW = new Date("2026-10-25T12:00:00.000Z");

export const MINUTE = 60 * 1000;

/** The Planner continuing their own Thread under the Context policy, with a ~3k Brief. */
export function aContinuation(
  minutesSinceLastCall: number,
  contextTokens: number,
  fields: Partial<Continuation> = {},
): Continuation {
  return {
    now: NOW,
    session: {
      roleKey: "planner",
      engineId: "claude-code",
      lastCallAt: new Date(NOW.getTime() - minutesSinceLastCall * MINUTE),
      contextTokens,
      startContextTokens: 0,
      full: false,
      changesAllowed: false,
    },
    roleKey: "planner",
    sessionDefault: "context-policy",
    engineId: "claude-code",
    override: undefined,
    briefTokens: 3_000,
    ...fields,
  };
}
