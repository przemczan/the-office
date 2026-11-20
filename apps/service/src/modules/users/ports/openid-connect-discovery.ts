import type { DiscoveredProvider } from "../domain/openid-connect-provider.js";

/**
 * Reads an issuer's OpenID Connect discovery document, `<issuer>/.well-known/openid-configuration`,
 * as the provider is saved.
 */
export abstract class OpenIdConnectDiscovery {
  /** What the document says. Throws `OpenIdConnectDiscoveryFailed` with why. */
  abstract discover(issuer: string): Promise<DiscoveredProvider>;
}

/** The document couldn't be read or isn't one, with why in the page's words. */
export class OpenIdConnectDiscoveryFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "OpenIdConnectDiscoveryFailed";
  }
}
