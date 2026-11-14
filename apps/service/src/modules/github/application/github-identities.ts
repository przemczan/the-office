import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { GitHubApp } from "../domain/github-app.js";
import { GitHubIdentityFailed, type GitHubIdentity } from "../domain/github-identity.js";
import { GitHubApi, GitHubApiFailure, type SignInCode } from "../ports/github-api.js";
import { GitHubAppRepository } from "../ports/github-app-repository.js";
import { refusalReason } from "./github-sign-in.js";
import { gitHubUrl, GitHubUrls } from "./github-urls.js";

/** What the caller's trip to GitHub's authorize page carries; the caller keeps it until GitHub sends the browser back. */
export interface IdentityAuthorization {
  readonly state: string;
  /** PKCE's secret, whose SHA-256 the authorize page is sent. */
  readonly codeVerifier: string;
  /** One of the App's callback URLs. */
  readonly redirectUri: string;
}

/** What GitHub sent the browser back with, and what the caller kept of its trip. */
export interface IdentityReturn {
  readonly code: string | undefined;
  /** Set instead of a code when the user cancelled on GitHub or GitHub refused. */
  readonly error: string | undefined;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/**
 * Who a person is on GitHub, for Continue with GitHub (spec §2.10), through the GitHub App
 * registered for Sign in with GitHub, by its user authorization flow. It proves who they are and
 * nothing more: it never reads or changes Sign in with GitHub's sign-in, asks for no scope (so no
 * `offline_access`), and revokes the token GitHub hands out as soon as it has read the user, keeping
 * nothing of it.
 */
@Injectable()
export class GitHubIdentities {
  private readonly logger = new Logger(GitHubIdentities.name);

  constructor(
    private readonly urls: GitHubUrls,
    private readonly api: GitHubApi,
    private readonly apps: GitHubAppRepository,
  ) {}

  /** Whether the GitHub App is registered, which Continue with GitHub signs in through. */
  async isAvailable(): Promise<boolean> {
    return (await this.apps.read()) !== undefined;
  }

  /** GitHub's authorize page for the browser to go to. Throws `GitHubIdentityFailed` before the App is registered. */
  async authorizeUrl({ state, codeVerifier, redirectUri }: IdentityAuthorization): Promise<string> {
    const app = await this.registeredApp();
    const url = gitHubUrl(this.urls.web, "/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  /**
   * Exchanges the code for a user token, reads who it belongs to and revokes it. Throws
   * `GitHubIdentityFailed` with why.
   */
  async identityOf({
    code,
    error,
    codeVerifier,
    redirectUri,
  }: IdentityReturn): Promise<GitHubIdentity> {
    if (error !== undefined) throw new GitHubIdentityFailed(refusalReason(error));
    if (code === undefined) throw new GitHubIdentityFailed("GitHub sent no code. Try again.");
    const app = await this.registeredApp();
    const accessToken = await this.exchange(app, { code, codeVerifier, redirectUri });
    try {
      const user = await this.api.userOf(accessToken).catch(failed);
      return { subject: String(user.id), name: user.login };
    } finally {
      await this.revoke(app, accessToken);
    }
  }

  private async registeredApp(): Promise<GitHubApp> {
    const app = await this.apps.read();
    if (app === undefined) {
      throw new GitHubIdentityFailed(
        "No GitHub App is registered: register it in Settings › Office identity first.",
      );
    }
    return app;
  }

  private async exchange(app: GitHubApp, code: SignInCode): Promise<string> {
    const answer = await this.api.exchangeSignInCode(app, code).catch(failed);
    if (answer.kind === "refused") throw new GitHubIdentityFailed(refusalReason(answer.error));
    return answer.tokens.accessToken;
  }

  /** Best effort: the token is thrown away whatever comes of it, and the log never holds it. */
  private async revoke(app: GitHubApp, accessToken: string): Promise<void> {
    try {
      await this.api.revokeUserToken(app, accessToken);
    } catch (error) {
      const reason = error instanceof GitHubApiFailure ? error.message : "an unexpected error";
      this.logger.warn(`A Continue with GitHub token wasn't revoked: ${reason}`);
    }
  }
}

function failed(error: unknown): never {
  if (error instanceof GitHubApiFailure) throw new GitHubIdentityFailed(error.message);
  throw error;
}
