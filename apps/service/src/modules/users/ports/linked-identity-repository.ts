import type { IdentityProviderId, LinkedIdentity } from "../domain/linked-identity.js";

/** Where users' linked identities are kept: the provider's id and name for each, never a token. */
export abstract class LinkedIdentityRepository {
  /** The user's linked identities, the first linked first. */
  abstract listOf(userId: string): Promise<readonly LinkedIdentity[]>;

  /** The identity of this provider and subject, whoever's it is. */
  abstract findBySubject(
    provider: IdentityProviderId,
    subject: string,
  ): Promise<LinkedIdentity | undefined>;

  /**
   * Keeps it, unless the identity is linked already or the user has one of this provider; says
   * whether it was kept.
   */
  abstract add(identity: LinkedIdentity): Promise<boolean>;

  /** Writes its name and last sign-in. */
  abstract save(identity: LinkedIdentity): Promise<void>;

  /** Forgets the user's identity of this provider; says whether they had one. */
  abstract remove(userId: string, provider: IdentityProviderId): Promise<boolean>;

  abstract removeAllOf(userId: string): Promise<void>;

  /** Forgets every user's identity of this provider; says how many there were. */
  abstract removeAllAt(provider: IdentityProviderId): Promise<number>;
}
