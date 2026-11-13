/**
 * Why a sign-in is refused: a wrong email or password, the slow-down's wait, the lockout, or a
 * right one-time password past its 7 days.
 */
export type SignInRefusal = "wrong" | "slow-down" | "locked" | "expired";

const MESSAGES: Readonly<Record<SignInRefusal, string>> = {
  wrong: "The email or password is wrong.",
  "slow-down": "Too many wrong tries in a row: wait a moment before the next one.",
  locked: "Too many wrong tries: signing in with a password is locked for a while.",
  expired: "This one-time password has expired: ask for a new one.",
};

/**
 * A sign-in refused. An unknown email gets the same refusal as a wrong password, so it never tells
 * which emails The Office knows.
 */
export class SignInRefused extends Error {
  private constructor(
    readonly refusal: SignInRefusal,
    /** When the next try is taken, once the tries cost a wait. */
    readonly tryAgainAt: Date | undefined,
  ) {
    super(MESSAGES[refusal]);
    this.name = "SignInRefused";
  }

  static wrong(tryAgainAt?: Date): SignInRefused {
    return new SignInRefused("wrong", tryAgainAt);
  }

  static slowDown(tryAgainAt: Date): SignInRefused {
    return new SignInRefused("slow-down", tryAgainAt);
  }

  static locked(until: Date): SignInRefused {
    return new SignInRefused("locked", until);
  }

  /** Told only to someone who typed the right one-time password, so it gives nothing away. */
  static expired(): SignInRefused {
    return new SignInRefused("expired", undefined);
  }
}
