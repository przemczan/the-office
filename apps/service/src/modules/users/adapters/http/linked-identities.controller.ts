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
  async list(@SignedIn() { userId }: SignedIn): Promise<LinkedIdentityList> {
    const links = await this.linkedIdentities.listOf(userId);
    return links.map(({ provider, available, linked }) => ({
      provider,
      available,
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
  async linkGitHub(
    @SignedIn() { userId, signedInDeviceId }: SignedIn,
    @Req() request: Request,
  ): Promise<IdentityAuthorization> {
    const page = pageAddressOf(request, this.officeAddresses);
    const authorizeUrl = await this.linkedIdentities.startLinking(
      userId,
      signedInDeviceId,
      "github",
      identityCallbackUrlOf(page, request, "github"),
      LINKED_IDENTITIES_PATH,
    );
    return { authorizeUrl };
  }

  @Delete("linked-identities/github")
  @HttpCode(204)
  async unlinkGitHub(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.linkedIdentities.unlink(userId, "github");
  }

  /** The callback URLs the GitHub App must list, for Settings › Office identity. */
  @Get("identity-callback-urls/github")
  gitHubCallbackUrls(@Req() request: Request): IdentityCallbackUrls {
    return identityCallbackUrlsOf(pageAddressOf(request, this.officeAddresses), request, "github");
  }
}
