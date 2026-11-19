import type { DiscoveredProvider } from "../domain/openid-connect-provider.js";
import {
  OpenIdConnectDiscovery,
  OpenIdConnectDiscoveryFailed,
} from "./openid-connect-discovery.js";

/**
 * Discovery standing for the issuers' own: each issuer answers its own name and endpoints under it,
 * unless a test gives it another document or a failure.
 */
export class FakeOpenIdConnectDiscovery extends OpenIdConnectDiscovery {
  /** Every issuer read, in order. */
  readonly read: string[] = [];
  private readonly answers = new Map<string, DiscoveredProvider | OpenIdConnectDiscoveryFailed>();

  answer(issuer: string, answer: DiscoveredProvider | OpenIdConnectDiscoveryFailed): void {
    this.answers.set(issuer, answer);
  }

  discover(issuer: string): Promise<DiscoveredProvider> {
    this.read.push(issuer);
    const answer = this.answers.get(issuer) ?? {
      issuer,
      authorizationEndpoint: `${issuer}/oauth/v2/authorize`,
      tokenEndpoint: `${issuer}/oauth/v2/token`,
    };
    return answer instanceof OpenIdConnectDiscoveryFailed
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  }
}

/** Binds discovery to a fake, so saving the provider reads nothing over the network. */
export function openIdConnectDiscoveryForTests(): {
  provide: typeof OpenIdConnectDiscovery;
  useValue: FakeOpenIdConnectDiscovery;
} {
  return { provide: OpenIdConnectDiscovery, useValue: new FakeOpenIdConnectDiscovery() };
}
