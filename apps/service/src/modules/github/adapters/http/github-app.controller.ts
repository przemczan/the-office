import { Controller, Get, Query, Redirect, Req } from "@nestjs/common";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubAppManifestForm,
} from "@the-office/contracts";
import type { Request } from "express";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { AppRegistration } from "../../application/app-registration.js";
import { GitHubAppRegistrationFailed } from "../../domain/github-app.js";
import { textOrUndefined } from "../../../../platform/http/query-text.js";
import { officeOriginOf, returnUrlsOf } from "./github-return-urls.js";

/** Registering the GitHub App by its manifest, from Settings › Office identity. */
@Controller("github/app")
export class GitHubAppController {
  constructor(
    private readonly registration: AppRegistration,
    private readonly addresses: OfficeAddresses,
  ) {}

  /**
   * The form the browser posts to GitHub. GitHub sends the browser back to the address it reached
   * The Office on, which is the Office's own origin whatever address the service listens on; the
   * App also lists Continue with GitHub's callback there and at the public address.
   */
  @Get("manifest")
  manifest(@Req() request: Request): GitHubAppManifestForm {
    const officeOrigin = officeOriginOf(request, this.addresses);
    const { action, manifest } = this.registration.manifestForm(
      officeOrigin,
      returnUrlsOf(officeOrigin, this.addresses.publicAddress),
    );
    return { action, manifest: JSON.stringify(manifest) };
  }

  /**
   * Where GitHub sends the browser back. A page the browser navigates to, so every outcome
   * redirects to Settings › Office identity, a failure carrying why.
   */
  @Get("registered")
  @Redirect()
  async registered(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
  ): Promise<{ url: string }> {
    try {
      await this.registration.complete(textOrUndefined(code), textOrUndefined(state));
      return { url: OFFICE_IDENTITY_SETTINGS_PATH };
    } catch (error) {
      if (!(error instanceof GitHubAppRegistrationFailed)) throw error;
      const query = new URLSearchParams({
        [GITHUB_APP_REGISTRATION_FAILED_PARAMETER]: error.reason,
      });
      return { url: `${OFFICE_IDENTITY_SETTINGS_PATH}?${query}` };
    }
  }
}
