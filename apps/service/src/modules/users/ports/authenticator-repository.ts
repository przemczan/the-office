import type { Authenticator } from "../domain/authenticator.js";

/**
 * Where users' authenticators and recovery codes are kept, together, since the codes go with the
 * authenticator. Recovery codes are kept only as hashes.
 */
export abstract class AuthenticatorRepository {
  abstract find(userId: string): Promise<Authenticator | undefined>;

  /**
   * Keeps a new authenticator not yet confirmed, in place of any earlier one not confirmed. Says
   * whether it was kept: not when the user's authenticator is already on.
   */
  abstract replaceUnconfirmed(authenticator: Authenticator): Promise<boolean>;

  /**
   * Turns the user's authenticator on, the step of its first code taken, with these recovery code
   * hashes, all at once. Says whether it did: not when it is no longer waiting to be confirmed with
   * this secret, as when it was set up again since.
   */
  abstract confirm(
    authenticator: Authenticator,
    step: number,
    confirmedAt: Date,
    recoveryCodeHashes: readonly string[],
  ): Promise<boolean>;

  /**
   * Takes this time step's code: says whether it was taken, which it isn't when the authenticator
   * is off or a code of this step or a later one was already taken, by another request too.
   */
  abstract takeStep(userId: string, step: number): Promise<boolean>;

  /** Replaces all the user's recovery codes while the authenticator is on; says whether it did. */
  abstract replaceRecoveryCodes(
    userId: string,
    recoveryCodeHashes: readonly string[],
    madeAt: Date,
  ): Promise<boolean>;

  /** Uses up the user's unused recovery code with this hash; says whether there was one. */
  abstract useRecoveryCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean>;

  abstract recoveryCodesLeft(userId: string): Promise<number>;

  /** Removes the user's authenticator and recovery codes; says whether there was one. */
  abstract remove(userId: string): Promise<boolean>;
}
