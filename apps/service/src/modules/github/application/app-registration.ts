import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  gitHubAppManifest,
  GitHubAppRegistrationFailed,
  type GitHubApp,
  type GitHubAppManifest,
  type ManifestReturnUrls,
} from "../domain/github-app.js";
import { GitHubAppRegistered } from "../domain/github-events.js";
import { GitHubApi, GitHubApiFailure } from "../ports/github-api.js";
import { GitHubAppRepository } from "../ports/github-app-repository.js";
import { gitHubUrl, GitHubUrls } from "./github-urls.js";
import { PendingStates } from "./pending-states.js";

/** GitHub's limit on the whole manifest flow, from posting the form to converting the code. */
const MANIFEST_FLOW_MS = 60 * 60 * 1000;

export interface ManifestForm {
  /** Where the browser posts the form: GitHub's page for a new App, carrying the state. */
  readonly action: string;
  readonly manifest: GitHubAppManifest;
}

/**
 * Registering the GitHub App by GitHub's manifest flow: the browser posts the manifest to GitHub,
 * GitHub sends it back with a code, and The Office converts the code into the App it keeps.
 */
@Injectable()
export class AppRegistration {
  private readonly pendingStates = new PendingStates<true>(MANIFEST_FLOW_MS);

  constructor(
    private readonly urls: GitHubUrls,
    private readonly api: GitHubApi,
    private readonly apps: GitHubAppRepository,
    private readonly events: EventBus,
  ) {}

  /** A form for the browser to post, GitHub sending it back to `returnUrls.registered` with a code. */
  manifestForm(officeOrigin: string, returnUrls: ManifestReturnUrls): ManifestForm {
    const state = this.pendingStates.issue(true);
    const action = gitHubUrl(this.urls.web, "/settings/apps/new");
    action.searchParams.set("state", state);
    return { action: action.href, manifest: gitHubAppManifest(officeOrigin, returnUrls) };
  }

  /**
   * Converts the code GitHub sent back with and keeps the App, replacing one registered before.
   * Throws `GitHubAppRegistrationFailed` with why.
   */
  async complete(code: string | undefined, state: string | undefined): Promise<GitHubApp> {
    if (this.pendingStates.take(state) === undefined) {
      throw new GitHubAppRegistrationFailed(
        "This registration wasn't started from this Office, or took longer than an hour. Register the App again.",
      );
    }
    if (code === undefined) {
      throw new GitHubAppRegistrationFailed(
        "GitHub sent no registration code. Register the App again.",
      );
    }
    const app = await this.convert(code);
    await this.apps.replace(app);
    await this.events.publish(new GitHubAppRegistered(app.slug, app.owner));
    return app;
  }

  private async convert(code: string): Promise<GitHubApp> {
    try {
      return await this.api.convertManifestCode(code);
    } catch (error) {
      if (error instanceof GitHubApiFailure) throw new GitHubAppRegistrationFailed(error.message);
      throw error;
    }
  }
}
