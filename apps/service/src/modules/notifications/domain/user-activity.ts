/**
 * How long without activity means the user left: the click-through's five minutes (the user's
 * answer of 2026-10-27, spec §2.7 Defaults).
 */
export const AWAY_AFTER_MS = 5 * 60_000;

/** When the user was last active in The Office, and where Since you left begins. */
export interface UserActivity {
  readonly lastActiveAt: Date;
  /** When the user last left: their last activity before an absence, or when first seen. */
  readonly leftAt: Date;
}

/**
 * The user's activity after they were active at `at`. Activity after an absence moves Since you
 * left to where the absence began; it then stays there for the whole visit.
 */
export function recordActivity(known: UserActivity | undefined, at: Date): UserActivity {
  if (!known) return { lastActiveAt: at, leftAt: at };
  if (at.getTime() <= known.lastActiveAt.getTime()) return known;
  const cameBack = at.getTime() - known.lastActiveAt.getTime() >= AWAY_AFTER_MS;
  return { lastActiveAt: at, leftAt: cameBack ? known.lastActiveAt : known.leftAt };
}
