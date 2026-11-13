import type { Passkey } from "../domain/passkey.js";

/** Where users' passkeys are kept, each with its public key only. */
export abstract class PasskeyRepository {
  abstract add(passkey: Passkey): Promise<void>;

  /** The user's own passkey of this id. */
  abstract find(userId: string, id: string): Promise<Passkey | undefined>;

  /** The passkey a browser names by its credential id when signing in, whoever's it is. */
  abstract findByCredentialId(credentialId: string): Promise<Passkey | undefined>;

  /** The user's passkeys, the first added first. */
  abstract listOf(userId: string): Promise<readonly Passkey[]>;

  /** Writes its name, counter and last use. */
  abstract save(passkey: Passkey): Promise<void>;

  /** Forgets the user's passkey; says whether they had it. */
  abstract remove(userId: string, id: string): Promise<boolean>;

  abstract removeAllOf(userId: string): Promise<void>;
}
