import { providerNameOf, type IdentityProviderId } from "../domain/linked-identity.js";
import { IdentityRefused } from "../domain/identity-refused.js";
import type { PageAddress } from "../domain/page-address.js";
import type { IdentityProvider } from "../ports/identity-provider.js";

/** The identity providers bound in `UsersModule.register`, in the order given. */
export class IdentityProviders {
  constructor(readonly all: readonly IdentityProvider[]) {}

  /** The bound provider; throws `IdentityRefused.unavailable` when none is. */
  of(provider: IdentityProviderId): IdentityProvider {
    const bound = this.all.find((candidate) => candidate.provider === provider);
    if (bound === undefined) throw IdentityRefused.unavailable(providerNameOf(provider));
    return bound;
  }

  /** The provider's name as the pages show it, the OpenID Connect provider's as it was set up. */
  nameOf(provider: IdentityProviderId): Promise<string> {
    return this.of(provider).displayName();
  }

  /**
   * The provider to start a trip to from a page at this address; throws `IdentityRefused` when it
   * isn't set up or doesn't work there.
   */
  async startingAt(provider: IdentityProviderId, page: PageAddress): Promise<IdentityProvider> {
    const bound = this.of(provider);
    if (!(await bound.isAvailable())) {
      throw IdentityRefused.unavailable(await bound.displayName());
    }
    const why = bound.unavailableAt(page);
    if (why !== undefined) throw IdentityRefused.notHere(await bound.displayName(), why);
    return bound;
  }
}
