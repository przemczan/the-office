import { Injectable, Logger } from "@nestjs/common";
import {
  ArcticFetchError,
  CodeChallengeMethod,
  decodeIdToken,
  OAuth2Client,
  OAuth2RequestError,
  type OAuth2Tokens,
} from "arctic";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import { providerNameOf } from "../../domain/linked-identity.js";
import type { OpenIdConnectProvider } from "../../domain/openid-connect-provider.js";
import type { PageAddress } from "../../domain/page-address.js";
import type { WayUnavailable } from "../../domain/sign-in-way.js";
import {
  IdentityProvider,
  IdentityProviderFailed,
  type IdentityAuthorization,
  type IdentityReturn,
  type ProviderAnswer,
} from "../../ports/identity-provider.js";
import { OpenIdConnectProviderRepository } from "../../ports/openid-connect-provider-repository.js";

/**
 * Only who the person is: `openid` for the ID token's `sub`, `email` and `profile` for a name to
 * show. No `offline_access`, so the provider hands out no refresh token.
 */
const SCOPES = ["openid", "email", "profile"];

/**
 * Continue with <name> (spec §2.10), by OpenID Connect's authorization code flow with PKCE through
 * `arctic`'s generic client, at the endpoints the provider's discovery document named when it was
 * saved in Settings › Signing in; the client secret goes to the token endpoint by HTTP Basic. It
 * works at every address, as the provider decides which redirect URIs it accepts. The access token
 * is thrown away.
 */
@Injectable()
export class OpenIdConnectIdentityProvider extends IdentityProvider {
  readonly provider = "openid-connect";
  private readonly logger = new Logger(OpenIdConnectIdentityProvider.name);

  constructor(
    private readonly providers: OpenIdConnectProviderRepository,
    private readonly schedule: Schedule,
  ) {
    super();
  }

  override async displayName(): Promise<string> {
    return (await this.providers.find())?.name ?? providerNameOf(this.provider);
  }

  async isAvailable(): Promise<boolean> {
    return (await this.providers.find()) !== undefined;
  }

  unavailableAt(_page: PageAddress): WayUnavailable | undefined {
    return undefined;
  }

  async authorizeUrl({ state, codeVerifier, redirectUri }: IdentityAuthorization): Promise<string> {
    const saved = await this.saved();
    return clientOf(saved, redirectUri).createAuthorizationURLWithPKCE(
      saved.authorizationEndpoint,
      state,
      CodeChallengeMethod.S256,
      codeVerifier,
      SCOPES,
    ).href;
  }

  async identityOf({
    code,
    error,
    codeVerifier,
    redirectUri,
  }: IdentityReturn): Promise<ProviderAnswer> {
    const saved = await this.saved();
    if (error !== undefined || code === undefined) {
      throw refusedAtProvider(saved.name, error, redirectUri);
    }
    const tokens = await clientOf(saved, redirectUri)
      .validateAuthorizationCode(saved.tokenEndpoint, code, codeVerifier)
      .catch((failure: unknown) => this.tokenRequestFailed(failure, saved.name, redirectUri));
    return this.personOf(tokens, saved);
  }

  private async saved(): Promise<OpenIdConnectProvider> {
    const saved = await this.providers.find();
    if (saved === undefined) {
      throw new IdentityProviderFailed(
        `Continue with ${providerNameOf(this.provider)} isn't set up in this Office.`,
      );
    }
    return saved;
  }

  /**
   * The ID token's `sub`, and a name to show: its email, else its user name, else the `sub`. It
   * came straight from the token endpoint over TLS, so its signature isn't checked (OpenID Connect
   * Core 3.1.3.7); its issuer, audience and expiry are.
   */
  private personOf(
    tokens: OAuth2Tokens,
    { name, issuer, clientId }: OpenIdConnectProvider,
  ): ProviderAnswer {
    const claims = idTokenClaimsOf(tokens, name);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
    if (
      claims.iss !== issuer ||
      !audiences.includes(clientId) ||
      expiresAt <= this.schedule.now().getTime() ||
      typeof claims.sub !== "string" ||
      claims.sub === ""
    ) {
      this.logger.warn(
        "The OpenID Connect provider's ID token was refused: its issuer, audience or expiry is wrong.",
      );
      throw new IdentityProviderFailed(
        `${name}'s answer wasn't for this Office's client at ${issuer}, or came too late. Try again.`,
      );
    }
    return {
      subject: claims.sub,
      name: textOf(claims.email) ?? textOf(claims.preferred_username) ?? claims.sub,
    };
  }

  /** The token endpoint refused or couldn't be reached; logged by the OAuth error code only. */
  private tokenRequestFailed(failure: unknown, name: string, redirectUri: string): never {
    if (failure instanceof OAuth2RequestError) {
      this.logger.warn(
        `The OpenID Connect provider's token endpoint refused the code: ${failure.code}.`,
      );
      throw refusedAtProvider(name, failure.code, redirectUri);
    }
    if (failure instanceof ArcticFetchError) {
      this.logger.warn("The OpenID Connect provider's token endpoint couldn't be reached.");
      throw new IdentityProviderFailed(`${name} couldn't be reached. Try again.`);
    }
    this.logger.warn("The OpenID Connect provider's token endpoint answered something unexpected.");
    throw new IdentityProviderFailed(`${name} answered something unexpected. Try again.`);
  }
}

/** arctic fixes the redirect URI in the client, and The Office's differs by address. */
function clientOf(
  { clientId, clientSecret }: OpenIdConnectProvider,
  redirectUri: string,
): OAuth2Client {
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

interface IdTokenClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly sub?: unknown;
  readonly email?: unknown;
  readonly preferred_username?: unknown;
}

function idTokenClaimsOf(tokens: OAuth2Tokens, name: string): IdTokenClaims {
  try {
    const claims = decodeIdToken(tokens.idToken());
    if (typeof claims === "object" && claims !== null) return claims;
  } catch {
    // Missing or not a JWT: refused below.
  }
  throw new IdentityProviderFailed(`${name}'s answer had no ID token. Try again.`);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The provider's error, from its redirect or its token endpoint, in the page's words. */
function refusedAtProvider(
  name: string,
  error: string | undefined,
  redirectUri: string,
): IdentityProviderFailed {
  switch (error) {
    case "access_denied":
      return new IdentityProviderFailed(`You cancelled at ${name}, so nothing was done.`);
    case "invalid_request":
    case "redirect_uri_mismatch":
      return new IdentityProviderFailed(
        `${name} refused the request: check that its app lists ${redirectUri} as a redirect URI.`,
      );
    case "invalid_client":
    case "unauthorized_client":
      return new IdentityProviderFailed(
        `${name} doesn't accept the client ID or secret: check them in Settings › Signing in.`,
      );
    case "invalid_grant":
      return new IdentityProviderFailed(`${name} no longer accepts this sign-in. Try again.`);
    case undefined:
      return new IdentityProviderFailed(`${name} sent the browser back without a code. Try again.`);
    default:
      return new IdentityProviderFailed(`${name} refused (${error}). Try again.`);
  }
}
