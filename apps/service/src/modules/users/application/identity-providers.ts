import type { IdentityProviderId } from "../domain/linked-identity.js";
import { IdentityRefused } from "../domain/identity-refused.js";
import type { IdentityProvider } from "../ports/identity-provider.js";

/** The identity providers bound in `UsersModule.register`, in the order given. */
export class IdentityProviders {
  constructor(readonly all: readonly IdentityProvider[]) {}

  /** The bound provider; throws `IdentityRefused.unavailable` when none is. */
  of(provider: IdentityProviderId): IdentityProvider {
    const bound = this.all.find((candidate) => candidate.provider === provider);
    if (bound === undefined) throw IdentityRefused.unavailable(provider);
    return bound;
  }
}
