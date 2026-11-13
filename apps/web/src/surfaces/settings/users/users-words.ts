import type { User } from "@the-office/contracts";

/** Where a user stands, as their row says it: waiting for their first sign-in, or nothing to say. */
export interface UserStanding {
  readonly words: string;
  readonly tone: "neutral" | "warning";
}

/**
 * A user who hasn't set their own password yet waits for their first sign-in, with a one-time
 * password that works until its expiry (spec §2.10 Defaults); undefined once they have.
 */
export function standingOf(user: User, now: Date): UserStanding | undefined {
  if (user.oneTimePasswordExpiresAt === null) return undefined;
  if (new Date(user.oneTimePasswordExpiresAt) <= now) {
    return { words: "One-time password expired", tone: "warning" };
  }
  return { words: "Waiting for first sign-in", tone: "neutral" };
}
