import { providerNameOf, type IdentityProviderId } from "../domain/linked-identity.js";
import type { PageAddress } from "../domain/page-address.js";
import type { WayUnavailable } from "../domain/sign-in-way.js";

/** What a trip to the provider's authorize page carries, kept by The Office until it comes back. */
export interface IdentityAuthorization {
  readonly state: string;
  /** PKCE's secret, whose SHA-256 the authorize page is sent. */
  readonly codeVerifier: string;
  /** The callback URL the provider sends the browser back to. */
  readonly redirectUri: string;
}

/** What the provider sent the browser back with, and what The Office kept of the trip. */
export interface IdentityReturn {
  readonly code: string | undefined;
  /** Set instead of a code when the user cancelled or the provider refused. */
  readonly error: string | undefined;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/** Who the person is at the provider: its own id for them, and its name for them, shown only. */
export interface ProviderAnswer {
  readonly subject: string;
  readonly name: string;
}

/**
 * A provider a user links an identity of and signs in with (spec §2.10), by OAuth's authorization
 * code flow with PKCE. It only proves who the person is: whatever token it is handed is thrown
 * away. Each provider's adapter, such as `GitHubIdentityProvider` and `GoogleIdentityProvider`, is
 * bound through `UsersModule.register`'s `identityProviders`.
 */
export abstract class IdentityProvider {
  abstract readonly provider: IdentityProviderId;

  /** Its name as the pages show it, in "Continue with <name>". */
  displayName(): Promise<string> {
    return Promise.resolve(providerNameOf(this.provider));
  }

  /** Whether it is set up, such as the GitHub App registered. */
  abstract isAvailable(): Promise<boolean>;

  /** Why it doesn't work on a page opened at this address, or undefined when it does. */
  abstract unavailableAt(page: PageAddress): WayUnavailable | undefined;

  /** The provider's authorize page. Throws `IdentityProviderFailed` with why. */
  abstract authorizeUrl(authorization: IdentityAuthorization): Promise<string>;

  /** Who the person is, from the code the provider sent back. Throws `IdentityProviderFailed` with why. */
  abstract identityOf(returned: IdentityReturn): Promise<ProviderAnswer>;
}

/** The provider couldn't say who the person is, with why in the page's words. */
export class IdentityProviderFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "IdentityProviderFailed";
  }
}
