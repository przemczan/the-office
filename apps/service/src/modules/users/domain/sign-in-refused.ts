/**
 * Why a sign-in is refused: a wrong email, password or code, the slow-down's wait, the lockout, a
 * right one-time password past its 7 days, or a passkey that didn't sign anyone in.
 */
export type SignInRefusal = "wrong" | "slow-down" | "locked" | "expired" | "passkey";

/** What was tried: the password, or an authenticator or recovery code. */
export type TriedWith = "password" | "code";

const WRONG: Readonly<Record<TriedWith, string>> = {
  password: "The email or password is wrong.",
  code: "The code is wrong.",
};
const SLOW_DOWN = "Too many wrong tries in a row: wait a moment before the next one.";
const LOCKED = "Too many wrong tries: signing in with a password or code is locked for a while.";
const EXPIRED = "This one-time password has expired: ask for a new one.";
const PASSKEY = "That passkey didn't sign you in: try again, or use another way.";

/**
 * A sign-in refused. An unknown email gets the same refusal as a wrong password, so it never tells
 * which emails The Office knows.
 */
export class SignInRefused extends Error {
  private constructor(
    readonly refusal: SignInRefusal,
    message: string,
    /** When the next try is taken, once the tries cost a wait. */
    readonly tryAgainAt: Date | undefined,
  ) {
    super(message);
    this.name = "SignInRefused";
  }

  static wrong(triedWith: TriedWith, tryAgainAt?: Date): SignInRefused {
    return new SignInRefused("wrong", WRONG[triedWith], tryAgainAt);
  }

  static slowDown(tryAgainAt: Date): SignInRefused {
    return new SignInRefused("slow-down", SLOW_DOWN, tryAgainAt);
  }

  static locked(until: Date): SignInRefused {
    return new SignInRefused("locked", LOCKED, until);
  }

  /** Told only to someone who typed the right one-time password, so it gives nothing away. */
  static expired(): SignInRefused {
    return new SignInRefused("expired", EXPIRED, undefined);
  }

  /**
   * One answer for every way a passkey sign-in fails, so it tells nothing of which passkeys or
   * users The Office knows.
   */
  static passkey(): SignInRefused {
    return new SignInRefused("passkey", PASSKEY, undefined);
  }
}
