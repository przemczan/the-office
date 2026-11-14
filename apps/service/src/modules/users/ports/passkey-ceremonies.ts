import type { NewCredential, Passkey } from "../domain/passkey.js";
import type { PendingCeremony } from "../domain/pending-ceremony.js";
import type { RelyingParty } from "../domain/relying-party.js";
import type { User } from "../domain/user.js";

/** The options a ceremony starts with, for the browser, and the challenge they carry. */
export interface CeremonyStart {
  readonly challenge: string;
  /** WebAuthn's JSON options, which the HTTP adapter answers in the contracts' shape. */
  readonly options: unknown;
}

/** A browser's answer to a ceremony: WebAuthn's JSON, and what it names. */
export interface CeremonyAnswer {
  /** The credential's id, base64url. */
  readonly credentialId: string;
  /** The user handle a passkey answers a sign-in with; none when adding one. */
  readonly userHandle: string | undefined;
  readonly json: unknown;
}

/**
 * The WebAuthn ceremonies (spec §2.10): options for adding a passkey and for signing in with one,
 * and the checks of the browser's answers against the pending ceremony, its challenge, origin and
 * relying party, with user verification required.
 */
export abstract class PasskeyCeremonies {
  /**
   * Options for a new discoverable passkey of the user's, refusing those they already have at this
   * relying party.
   */
  abstract addingOptions(
    relyingParty: RelyingParty,
    user: User,
    existing: readonly Passkey[],
  ): Promise<CeremonyStart>;

  /** The new passkey, once the answer passes every check, or undefined. */
  abstract checkAdding(
    answer: CeremonyAnswer,
    ceremony: PendingCeremony,
  ): Promise<NewCredential | undefined>;

  /** Options for signing in with any passkey kept for this relying party, naming no user. */
  abstract signingInOptions(relyingParty: RelyingParty): Promise<CeremonyStart>;

  /**
   * The counter the passkey reported, once the answer is signed by it and passes every check, or
   * undefined. The counter's own rule is the caller's (`isPossibleClone`).
   */
  abstract checkSigningIn(
    answer: CeremonyAnswer,
    ceremony: PendingCeremony,
    passkey: Passkey,
  ): Promise<{ readonly counter: number } | undefined>;
}
