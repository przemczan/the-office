import { Controller, Get, Query, Redirect, Req } from "@nestjs/common";
import {
  API_PATH,
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubAppManifestForm,
} from "@the-office/contracts";
import type { Request } from "express";
import { AppRegistration } from "../../application/app-registration.js";
import { GitHubAppRegistrationFailed } from "../../domain/github-app.js";

const REGISTERED_PATH = "github/app/registered";

/** Registering the GitHub App by its manifest, from Settings › Office identity. */
@Controller("github/app")
export class GitHubAppController {
  constructor(private readonly registration: AppRegistration) {}

  /**
   * The form the browser posts to GitHub. GitHub sends the browser back to the address it reached
   * The Office on, which is the Office's own origin whatever address the service listens on.
   */
  @Get("manifest")
  manifest(@Req() request: Request): GitHubAppManifestForm {
    const officeOrigin = `${request.protocol}://${request.host}`;
    const { action, manifest } = this.registration.manifestForm(
      officeOrigin,
      `${officeOrigin}${API_PATH}/${REGISTERED_PATH}`,
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

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
