import type { PendingSignIn } from "../domain/pending-sign-in.js";

/** Where sign-ins waiting for an authenticator code are kept, by their token's hash. */
export abstract class PendingSignInRepository {
  abstract add(pendingSignIn: PendingSignIn): Promise<void>;

  abstract findByTokenHash(tokenHash: string): Promise<PendingSignIn | undefined>;

  /** Removes it; says whether it was there, so two requests can't both use it up. */
  abstract remove(id: string): Promise<boolean>;

  /** Removes those expired by `now`. */
  abstract removeExpired(now: Date): Promise<void>;
}
