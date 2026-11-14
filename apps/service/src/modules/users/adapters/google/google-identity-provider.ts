import { Injectable, Logger } from "@nestjs/common";
import {
  ArcticFetchError,
  decodeIdToken,
  Google,
  OAuth2RequestError,
  type OAuth2Tokens,
} from "arctic";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { GoogleClient } from "../../domain/google-client.js";
import type { PageAddress } from "../../domain/page-address.js";
import { secureNameMissingAt, type WayUnavailable } from "../../domain/sign-in-way.js";
import { GoogleClientRepository } from "../../ports/google-client-repository.js";
import {
  IdentityProvider,
  IdentityProviderFailed,
  type IdentityAuthorization,
  type IdentityReturn,
  type ProviderAnswer,
} from "../../ports/identity-provider.js";

/**
 * Only who the person is: `openid` for the ID token's `sub`, `email` for a name to show. No
 * `access_type=offline`, so Google hands out no refresh token.
 */
const SCOPES = ["openid", "email"];

/** The issuers Google's ID tokens name (OpenID Connect Core 3.1.3.7, Google's discovery document). */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/**
 * Continue with Google (spec §2.10), by OpenID Connect's authorization code flow with PKCE through
 * `arctic`, with the Google OAuth client saved in Settings › Signing in. Google refuses an IP
 * address and plain HTTP but on `localhost` as a redirect URI, so it works at `localhost` and the
 * public address over HTTPS only. The access token is thrown away unrevoked: it ends within the
 * hour, and revoking it would make Google ask for consent at every sign-in.
 */
@Injectable()
export class GoogleIdentityProvider extends IdentityProvider {
  readonly provider = "google";
  private readonly logger = new Logger(GoogleIdentityProvider.name);

  constructor(
    private readonly clients: GoogleClientRepository,
    private readonly schedule: Schedule,
  ) {
    super();
  }

  async isAvailable(): Promise<boolean> {
    return (await this.clients.find()) !== undefined;
  }

  unavailableAt(page: PageAddress): WayUnavailable | undefined {
    return secureNameMissingAt(page);
  }

  async authorizeUrl({ state, codeVerifier, redirectUri }: IdentityAuthorization): Promise<string> {
    const google = googleOf(await this.savedClient(), redirectUri);
    return google.createAuthorizationURL(state, codeVerifier, SCOPES).href;
  }

  async identityOf({
    code,
    error,
    codeVerifier,
    redirectUri,
  }: IdentityReturn): Promise<ProviderAnswer> {
    if (error !== undefined || code === undefined) throw refusedAtGoogle(error, redirectUri);
    const client = await this.savedClient();
    const tokens = await googleOf(client, redirectUri)
      .validateAuthorizationCode(code, codeVerifier)
      .catch((failure: unknown) => this.tokenRequestFailed(failure, redirectUri));
    return this.personOf(tokens, client.clientId);
  }

  private async savedClient(): Promise<GoogleClient> {
    const client = await this.clients.find();
    if (client === undefined) {
      throw new IdentityProviderFailed("Continue with Google isn't set up in this Office.");
    }
    return client;
  }

  /**
   * The ID token's `sub` and email. It came straight from Google's token endpoint over TLS, so its
   * signature isn't checked (OpenID Connect Core 3.1.3.7); its issuer, audience and expiry are.
   */
  private personOf(tokens: OAuth2Tokens, clientId: string): ProviderAnswer {
    const claims = idTokenClaimsOf(tokens);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
    if (
      typeof claims.iss !== "string" ||
      !GOOGLE_ISSUERS.has(claims.iss) ||
      !audiences.includes(clientId) ||
      expiresAt <= this.schedule.now().getTime() ||
      typeof claims.sub !== "string" ||
      claims.sub === ""
    ) {
      this.logger.warn("Google's ID token was refused: its issuer, audience or expiry is wrong.");
      throw new IdentityProviderFailed(
        "Google's answer wasn't for this Office's Google OAuth client, or came too late. Try again.",
      );
    }
    const email =
      typeof claims.email === "string" && claims.email !== "" ? claims.email : undefined;
    return { subject: claims.sub, name: email ?? claims.sub };
  }

  /** Google's token endpoint refused or couldn't be reached; logged by the OAuth error code only. */
  private tokenRequestFailed(failure: unknown, redirectUri: string): never {
    if (failure instanceof OAuth2RequestError) {
      this.logger.warn(`Google's token endpoint refused the code: ${failure.code}.`);
      throw refusedAtGoogle(failure.code, redirectUri);
    }
    if (failure instanceof ArcticFetchError) {
      this.logger.warn("Google's token endpoint couldn't be reached.");
      throw new IdentityProviderFailed("Google couldn't be reached. Try again.");
    }
    this.logger.warn("Google's token endpoint answered something unexpected.");
    throw new IdentityProviderFailed("Google answered something unexpected. Try again.");
  }
}

/** arctic fixes the redirect URI in the client, and The Office's differs by address. */
function googleOf({ clientId, clientSecret }: GoogleClient, redirectUri: string): Google {
  return new Google(clientId, clientSecret, redirectUri);
}

interface IdTokenClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly sub?: unknown;
  readonly email?: unknown;
}

function idTokenClaimsOf(tokens: OAuth2Tokens): IdTokenClaims {
  try {
    const claims = decodeIdToken(tokens.idToken());
    if (typeof claims === "object" && claims !== null) return claims;
  } catch {
    // Missing or not a JWT: refused below.
  }
  throw new IdentityProviderFailed("Google's answer had no ID token. Try again.");
}

/** Google's error, from its redirect or its token endpoint, in the page's words. */
function refusedAtGoogle(error: string | undefined, redirectUri: string): IdentityProviderFailed {
  switch (error) {
    case "access_denied":
      return new IdentityProviderFailed("You cancelled at Google, so nothing was done.");
    case "redirect_uri_mismatch":
      return new IdentityProviderFailed(
        `Google's OAuth client doesn't list this address's redirect URI: add ${redirectUri} to it in Google Cloud Console.`,
      );
    case "invalid_client":
    case "unauthorized_client":
      return new IdentityProviderFailed(
        "Google doesn't accept the OAuth client's ID or secret: check them in Settings › Signing in.",
      );
    case "invalid_grant":
      return new IdentityProviderFailed("Google no longer accepts this sign-in. Try again.");
    case undefined:
      return new IdentityProviderFailed("Google sent the browser back without a code. Try again.");
    default:
      return new IdentityProviderFailed(`Google refused (${error}). Try again.`);
  }
}
