import { Controller, Delete, Get, HttpCode, Post, Req, UseFilters } from "@nestjs/common";
import {
  LINKED_IDENTITIES_PATH,
  type IdentityAuthorization,
  type IdentityCallbackUrls,
  type LinkedIdentityList,
} from "@the-office/contracts";
import type { Request } from "express";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { LinkedIdentities } from "../../application/linked-identities.js";
import type { IdentityProviderId } from "../../domain/linked-identity.js";
import { identityCallbackUrlOf, identityCallbackUrlsOf } from "./identity-callback-urls.js";
import { pageAddressOf } from "./sign-in-request.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The signed-in user's linked identities, on their account (spec §2.10): listed, linked through a
 * trip to the provider that comes back to `/sign-in/<provider>/callback`, and unlinked. Each
 * provider has its own explicit routes.
 */
@Controller("account")
@UseFilters(UserRefusalsFilter)
export class LinkedIdentitiesController {
  constructor(
    private readonly linkedIdentities: LinkedIdentities,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  @Get("linked-identities")
  async list(
    @SignedIn() { userId }: SignedIn,
    @Req() request: Request,
  ): Promise<LinkedIdentityList> {
    const page = pageAddressOf(request, this.officeAddresses);
    const links = await this.linkedIdentities.listOf(userId, page);
    return links.map(({ provider, providerName, available, unavailableHere, linked }) => ({
      provider,
      providerName,
      available,
      unavailableHere: unavailableHere ?? null,
      linked:
        linked === undefined
          ? null
          : {
              name: linked.name,
              linkedAt: linked.linkedAt.toISOString(),
              lastSignedInAt: linked.lastSignedInAt?.toISOString() ?? null,
            },
    }));
  }

  /** GitHub's authorize page, for linking the GitHub account the user signs in to there. */
  @Post("linked-identities/github")
  @HttpCode(200)
  linkGitHub(
    @SignedIn() signedIn: SignedIn,
    @Req() request: Request,
  ): Promise<IdentityAuthorization> {
    return this.startLinking("github", signedIn, request);
  }

  @Delete("linked-identities/github")
  @HttpCode(204)
  async unlinkGitHub(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.linkedIdentities.unlink(userId, "github");
  }

  /** The callback URLs the GitHub App must list, for Settings › Office identity. */
  @Get("identity-callback-urls/github")
  gitHubCallbackUrls(@Req() request: Request): IdentityCallbackUrls {
    return this.callbackUrls("github", request);
  }

  /** Google's authorize page, for linking the Google account the user signs in to there. */
  @Post("linked-identities/google")
  @HttpCode(200)
  linkGoogle(
    @SignedIn() signedIn: SignedIn,
    @Req() request: Request,
  ): Promise<IdentityAuthorization> {
    return this.startLinking("google", signedIn, request);
  }

  @Delete("linked-identities/google")
  @HttpCode(204)
  async unlinkGoogle(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.linkedIdentities.unlink(userId, "google");
  }

  /** The redirect URIs the Google OAuth client must list, for Settings › Signing in. */
  @Get("identity-callback-urls/google")
  googleCallbackUrls(@Req() request: Request): IdentityCallbackUrls {
    return this.callbackUrls("google", request);
  }

  /** The OpenID Connect provider's authorize page, for linking the user's identity there. */
  @Post("linked-identities/openid-connect")
  @HttpCode(200)
  linkOpenIdConnect(
    @SignedIn() signedIn: SignedIn,
    @Req() request: Request,
  ): Promise<IdentityAuthorization> {
    return this.startLinking("openid-connect", signedIn, request);
  }

  @Delete("linked-identities/openid-connect")
  @HttpCode(204)
  async unlinkOpenIdConnect(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.linkedIdentities.unlink(userId, "openid-connect");
  }

  /** The redirect URIs the OpenID Connect provider's app must list, for Settings › Signing in. */
  @Get("identity-callback-urls/openid-connect")
  openIdConnectCallbackUrls(@Req() request: Request): IdentityCallbackUrls {
    return this.callbackUrls("openid-connect", request);
  }

  private async startLinking(
    provider: IdentityProviderId,
    { userId, signedInDeviceId }: SignedIn,
    request: Request,
  ): Promise<IdentityAuthorization> {
    const page = pageAddressOf(request, this.officeAddresses);
    const authorizeUrl = await this.linkedIdentities.startLinking(
      userId,
      signedInDeviceId,
      provider,
      page,
      identityCallbackUrlOf(page, request, provider),
      LINKED_IDENTITIES_PATH,
    );
    return { authorizeUrl };
  }

  /** This address's callback URL only where the provider works, and the public address's. */
  private callbackUrls(provider: IdentityProviderId, request: Request): IdentityCallbackUrls {
    const page = pageAddressOf(request, this.officeAddresses);
    const worksHere = this.linkedIdentities.unavailableAt(provider, page) === undefined;
    return identityCallbackUrlsOf(page, request, provider, worksHere);
  }
}
