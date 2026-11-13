import { SignInRefused } from "./sign-in-refused.js";

/**
 * A user's wrong tries in a row at their password (spec §2.10 Defaults, "Slow-down and lockout"),
 * kept with the user so a restart doesn't reset them.
 */
export interface WrongTries {
  readonly inARow: number;
  /** The slow-down: no try is taken before it. */
  readonly nextTryAt: Date | undefined;
  /** The lockout: the password is refused until it. */
  readonly lockedUntil: Date | undefined;
}

export const NO_WRONG_TRIES: WrongTries = {
  inARow: 0,
  nextTryAt: undefined,
  lockedUntil: undefined,
};

/** The wrong tries in a row that cost nothing. */
const FREE_TRIES = 3;
/** The waits after each further wrong try, the last repeating until the lockout. */
const SLOW_DOWN_SECONDS = [2, 4, 8, 16] as const;
/** The wrong try in a row that locks the password, and every one after it until a right one. */
const LOCKING_TRY = 10;
const FIRST_LOCKOUT_MS = 15 * 60 * 1000;
const LONGEST_LOCKOUT_MS = 24 * 60 * 60 * 1000;

/** Why a try now isn't taken: the lockout, or the slow-down's wait; undefined when it is taken. */
export function tryRefusal(tries: WrongTries, now: Date): SignInRefused | undefined {
  if (tries.lockedUntil !== undefined && tries.lockedUntil > now) {
    return SignInRefused.locked(tries.lockedUntil);
  }
  if (tries.nextTryAt !== undefined && tries.nextTryAt > now) {
    return SignInRefused.slowDown(tries.nextTryAt);
  }
  return undefined;
}

/**
 * The tries after one more wrong one at `now`: the first three cost nothing, each further one
 * waits 2, 4, 8 and then 16 seconds, and the tenth in a row locks for 15 minutes, each lockout
 * after it (every further wrong try before a right one) twice as long as the one before, up to a day.
 */
export function afterWrongTry(tries: WrongTries, now: Date): WrongTries {
  const inARow = tries.inARow + 1;
  if (inARow >= LOCKING_TRY) {
    const lockouts = inARow - LOCKING_TRY;
    const lockout = Math.min(FIRST_LOCKOUT_MS * 2 ** lockouts, LONGEST_LOCKOUT_MS);
    const lockedUntil = new Date(now.getTime() + lockout);
    return { inARow, nextTryAt: undefined, lockedUntil };
  }
  if (inARow <= FREE_TRIES) return { inARow, nextTryAt: undefined, lockedUntil: undefined };
  const seconds = SLOW_DOWN_SECONDS[Math.min(inARow - FREE_TRIES, SLOW_DOWN_SECONDS.length) - 1];
  return {
    inARow,
    nextTryAt: new Date(now.getTime() + (seconds ?? 0) * 1000),
    lockedUntil: undefined,
  };
}

/** The answer to a wrong try: wrong, with when to try again once the tries cost a wait. */
export function wrongTryAnswer(tries: WrongTries): SignInRefused {
  if (tries.lockedUntil !== undefined) return SignInRefused.locked(tries.lockedUntil);
  return SignInRefused.wrong(tries.nextTryAt);
}
