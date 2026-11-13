/** Why a sign-in is refused: a wrong email or password, the slow-down's wait, or the lockout. */
export type SignInRefusal = "wrong" | "slow-down" | "locked";

const MESSAGES: Readonly<Record<SignInRefusal, string>> = {
  wrong: "The email or password is wrong.",
  "slow-down": "Too many wrong tries in a row: wait a moment before the next one.",
  locked: "Too many wrong tries: signing in with a password is locked for a while.",
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
}
