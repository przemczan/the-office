import { Injectable } from "@nestjs/common";
import type { IdentityProviderId } from "../../domain/linked-identity.js";
import type { PageAddress } from "../../domain/page-address.js";
import { secureNameMissingAt, type WayUnavailable } from "../../domain/sign-in-way.js";
import {
  IdentityProvider,
  IdentityProviderFailed,
  type IdentityAuthorization,
  type IdentityReturn,
  type ProviderAnswer,
} from "../../ports/identity-provider.js";

/** Where the fake's authorize page is; nothing serves it, tests read its query. */
export const FAKE_AUTHORIZE_URL = "https://provider.invalid/authorize";

/**
 * A provider standing for GitHub's: its authorize URL carries the state, verifier and callback URL
 * as given, and each code it hands out answers the person signed in to it when it was handed out.
 * It is bound as the `github` provider, so the routes and ways are GitHub's own;
 * `FakeGoogleIdentityProvider` is the same bound as `google`.
 */
@Injectable()
export class FakeIdentityProvider extends IdentityProvider {
  readonly provider: IdentityProviderId = "github";
  /** Whether it is set up, as the GitHub App registered. */
  available = true;
  /** Who signs in at the provider. */
  signedInAs: ProviderAnswer = { subject: "1001", name: "ada-on-github" };
  /** Every trip back it was asked about, so tests read the verifier and callback URL. */
  readonly returns: IdentityReturn[] = [];
  private readonly codes = new Map<string, ProviderAnswer & { readonly codeVerifier: string }>();

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  unavailableAt(_page: PageAddress): WayUnavailable | undefined {
    return undefined;
  }

  authorizeUrl({ state, codeVerifier, redirectUri }: IdentityAuthorization): Promise<string> {
    const url = new URL(FAKE_AUTHORIZE_URL);
    url.search = new URLSearchParams({ state, redirect_uri: redirectUri }).toString();
    this.codes.set(`code-of-${state}`, { ...this.signedInAs, codeVerifier });
    return Promise.resolve(url.href);
  }

  /** The code the provider sends the browser back with for the trip of `state`. */
  codeOf(state: string): string {
    return `code-of-${state}`;
  }

  identityOf(returned: IdentityReturn): Promise<ProviderAnswer> {
    this.returns.push(returned);
    if (returned.error !== undefined) {
      return Promise.reject(
        new IdentityProviderFailed(`The provider refused (${returned.error}).`),
      );
    }
    const answer = this.codes.get(returned.code ?? "");
    this.codes.delete(returned.code ?? "");
    if (answer === undefined || answer.codeVerifier !== returned.codeVerifier) {
      return Promise.reject(new IdentityProviderFailed("The provider no longer knows this code."));
    }
    return Promise.resolve({ subject: answer.subject, name: answer.name });
  }
}

/** The fake bound as `google`, which works only at `localhost` and the public address over HTTPS. */
@Injectable()
export class FakeGoogleIdentityProvider extends FakeIdentityProvider {
  override readonly provider: IdentityProviderId = "google";
  override signedInAs: ProviderAnswer = { subject: "1150000000000000001", name: "ada@example.com" };

  override unavailableAt(page: PageAddress): WayUnavailable | undefined {
    return secureNameMissingAt(page);
  }
}

/**
 * The fake bound as `openid-connect`, which works at every address, even an IP address, as the
 * provider decides which redirect URIs it accepts; its name is whatever a test sets.
 */
@Injectable()
export class FakeOpenIdConnectIdentityProvider extends FakeIdentityProvider {
  override readonly provider: IdentityProviderId = "openid-connect";
  override signedInAs: ProviderAnswer = { subject: "fixed-sub-of-ada", name: "ada@example.com" };
  /** The name the pages show, as saved in Settings › Signing in. */
  name = "Zitadel";

  override displayName(): Promise<string> {
    return Promise.resolve(this.name);
  }
}
