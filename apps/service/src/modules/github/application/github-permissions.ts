import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../platform/events/event-bus.js";
import {
  missingPermissions,
  type GitHubApp,
  type MissingPermission,
} from "../domain/github-app.js";
import {
  GitHubAppRegistered,
  GitHubPermissionsChecked,
  GitHubSignedIn,
  GitHubSignedOut,
} from "../domain/github-events.js";
import { GitHubAccessFailed } from "../domain/github-repository.js";
import { GitHubApi, GitHubApiFailure, type GitHubInstallation } from "../ports/github-api.js";
import { GitHubAppRepository } from "../ports/github-app-repository.js";
import { GitHubSignInRepository } from "../ports/github-sign-in-repository.js";
import { GitHubAccess } from "./github-access.js";
import { gitHubUrl, GitHubUrls } from "./github-urls.js";

/** How long an answer is kept: Settings reads it on each visit, and GitHub's settings rarely change. */
const KEPT_MS = 5 * 60 * 1000;

/**
 * The permissions the App needs that an installation hasn't granted: each once, the App's
 * permission settings to add them on, and the installations lacking any, to accept them on.
 */
export interface LackedPermissions {
  readonly missing: readonly MissingPermission[];
  readonly appPermissionsUrl: string;
  readonly installations: readonly { readonly account: string; readonly acceptUrl: string }[];
}

/**
 * Whether the App's installations granted every permission The Office needs, read from GitHub with
 * the user's token. An App registered before a permission was added keeps lacking it until its
 * owner adds it and each installation's owner accepts it, so Settings says where to.
 */
@Injectable()
export class GitHubPermissions implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitHubPermissions.name);
  private kept:
    { readonly at: number; readonly answer: Promise<LackedPermissions | undefined> } | undefined;
  private unsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly api: GitHubApi,
    private readonly apps: GitHubAppRepository,
    private readonly signIns: GitHubSignInRepository,
    private readonly events: EventBus,
    private readonly urls: GitHubUrls,
    private readonly access: GitHubAccess,
  ) {}

  onModuleInit(): void {
    const forget = (): void => this.forget();
    this.unsubscribes = [
      this.events.subscribe(GitHubSignedIn, forget),
      this.events.subscribe(GitHubSignedOut, forget),
      this.events.subscribe(GitHubAppRegistered, forget),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
  }

  /**
   * What the installations lack, or undefined when nothing is, no one is signed in, or GitHub
   * couldn't be asked. Kept five minutes, and dropped when the sign-in or the App changes.
   */
  lacking(): Promise<LackedPermissions | undefined> {
    if (this.kept !== undefined && Date.now() - this.kept.at < KEPT_MS) return this.kept.answer;
    const answer = this.ask();
    const kept = { at: Date.now(), answer };
    this.kept = kept;
    // A failure that isn't GitHub's isn't kept, so the next read asks again.
    answer.catch(() => {
      if (this.kept === kept) this.kept = undefined;
    });
    return answer;
  }

  /** Reads GitHub again, for Check again after the user granted the permissions there. */
  async checkAgain(): Promise<LackedPermissions | undefined> {
    this.forget();
    const answer = await this.lacking();
    await this.events.publish(new GitHubPermissionsChecked());
    return answer;
  }

  private forget(): void {
    this.kept = undefined;
  }

  private async ask(): Promise<LackedPermissions | undefined> {
    const app = await this.apps.read();
    if (app === undefined) return undefined;
    let installations: readonly GitHubInstallation[];
    try {
      const token = await this.access.userToken();
      if (token === undefined) return undefined;
      installations = await this.api.installationsOf(token);
    } catch (error) {
      if (!(error instanceof GitHubApiFailure || error instanceof GitHubAccessFailed)) throw error;
      // The message names GitHub's status, never its body or the token.
      this.logger.warn(`The GitHub App's permissions couldn't be read: ${error.message}`);
      return undefined;
    }
    const lacking = installations
      .filter((installation) => !installation.suspended)
      .map((installation) => ({
        installation,
        missing: missingPermissions(installation.permissions),
      }))
      .filter(({ missing }) => missing.length > 0);
    if (lacking.length === 0) return undefined;
    const missing = new Map<string, MissingPermission>();
    for (const permission of lacking.flatMap((each) => each.missing)) {
      missing.set(permission.name, permission);
    }
    return {
      missing: [...missing.values()],
      appPermissionsUrl: await this.appPermissionsUrl(app, installations),
      installations: lacking.map(({ installation }) => ({
        account: installation.account,
        acceptUrl: installation.url,
      })),
    };
  }

  /**
   * The App's permission settings, under its owner's settings: an organization's or the user's
   * own. The kept App names its owner by login only, so its kind comes from an installation on that
   * account; with none, an owner other than the signed-in user is taken as an organization, since
   * the user's own settings hold only the Apps they own themselves.
   */
  private async appPermissionsUrl(
    app: GitHubApp,
    installations: readonly GitHubInstallation[],
  ): Promise<string> {
    const owner = app.owner.toLowerCase();
    const onOwner = installations.find(
      (installation) => installation.account.toLowerCase() === owner,
    );
    const signedIn = await this.signIns.read();
    const isOrganization =
      onOwner !== undefined
        ? onOwner.accountType === "Organization"
        : signedIn?.status !== "signed-in" || signedIn.login.toLowerCase() !== owner;
    const slug = encodeURIComponent(app.slug);
    const path = isOrganization
      ? `/organizations/${encodeURIComponent(app.owner)}/settings/apps/${slug}/permissions`
      : `/settings/apps/${slug}/permissions`;
    return gitHubUrl(this.urls.web, path).href;
  }
}
