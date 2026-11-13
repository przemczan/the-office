/** How long a pending sign-in waits for its authenticator code. */
const PENDING_MS = 5 * 60 * 1000;

/**
 * A sign-in whose way was right but which still waits for an authenticator code (spec §2.10): its
 * token, carried by a cookie of its own, is kept only as its SHA-256 and signs nobody in. It is
 * used up by a right code, and never called a session.
 */
export interface PendingSignIn {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly madeAt: Date;
  readonly expiresAt: Date;
}

/** How long the browser keeps the pending sign-in's cookie, in seconds. */
export const PENDING_SIGN_IN_SECONDS = PENDING_MS / 1000;

export function pendingSignInOf(
  id: string,
  userId: string,
  tokenHash: string,
  now: Date,
): PendingSignIn {
  return { id, userId, tokenHash, madeAt: now, expiresAt: new Date(now.getTime() + PENDING_MS) };
}

export function isPending(pendingSignIn: PendingSignIn, now: Date): boolean {
  return pendingSignIn.expiresAt > now;
}
