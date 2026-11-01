import { createHash, randomBytes } from "node:crypto";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../platform/events/event-bus.js";
import type { GitHubApp } from "../domain/github-app.js";
import { GitHubAppRegistered, GitHubSignedIn, GitHubSignedOut } from "../domain/github-events.js";
import { GitHubSignInFailed, type SignedOutReason, type UserTokens } from "../domain/sign-in.js";
import { GitHubApi, GitHubApiFailure, type SignInCode } from "../ports/github-api.js";
import { GitHubAppRepository } from "../ports/github-app-repository.js";
import { GitHubSignInRepository } from "../ports/github-sign-in-repository.js";
import { gitHubUrl, GitHubUrls } from "./github-urls.js";
import { PendingStates } from "./pending-states.js";

/** GitHub's codes last ten minutes, so a trip to GitHub that takes longer can't finish anyway. */
const SIGN_IN_TRIP_MS = 10 * 60 * 1000;

/** Sign in with GitHub as Settings › Office identity shows it; no token is part of it. */
export type SignInState =
  | { readonly status: "not-registered" }
  | { readonly status: "signed-out"; readonly app: GitHubApp; readonly reason?: SignedOutReason }
  | { readonly status: "signed-in"; readonly app: GitHubApp; readonly login: string };

/** What a sign-in sent to GitHub, kept until GitHub sends the browser back. */
interface PendingSignIn {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

/** What GitHub sent the browser back with. */
export interface SignInReturn {
  readonly code: string | undefined;
  readonly state: string | undefined;
  /** Set instead of a code when the user cancelled on GitHub. */
  readonly error: string | undefined;
}

/**
 * Sign in with GitHub by GitHub's web flow for an App's user token: the browser goes to GitHub's
 * authorize page, GitHub sends it back with a code, and The Office exchanges the code, with the
 * App's client secret and PKCE's verifier, for the user's tokens.
 */
@Injectable()
export class GitHubSignIn implements OnModuleInit, OnModuleDestroy {
  private readonly pending = new PendingStates<PendingSignIn>(SIGN_IN_TRIP_MS);
  /**
   * Changes run one after another, so a token can't be kept after the sign-out, or the new App,
   * that came in while GitHub was being asked for it.
   */
  private changes: Promise<unknown> = Promise.resolve();
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly urls: GitHubUrls,
    private readonly api: GitHubApi,
    private readonly apps: GitHubAppRepository,
    private readonly signIns: GitHubSignInRepository,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(GitHubAppRegistered, () =>
      this.change(() => this.forgetForNewApp()),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async state(): Promise<SignInState> {
    const app = await this.apps.read();
    if (app === undefined) return { status: "not-registered" };
    const kept = await this.signIns.read();
    if (kept?.status === "signed-in") return { status: "signed-in", app, login: kept.login };
    return kept === undefined ? { status: "signed-out", app } : { ...kept, app };
  }

  /**
   * GitHub's authorize page for the browser to go to, GitHub sending it back to `redirectUri`,
   * which must be one of the App's callback URLs. Throws `GitHubSignInFailed` before the App is
   * registered or while signed in.
   */
  async authorizeUrl(redirectUri: string): Promise<string> {
    const app = await this.apps.read();
    if (app === undefined) {
      throw new GitHubSignInFailed(
        "Register the GitHub App first: Sign in with GitHub signs in through it.",
      );
    }
    const kept = await this.signIns.read();
    if (kept?.status === "signed-in") {
      throw new GitHubSignInFailed(
        `Already signed in to GitHub as ${kept.login}. Sign out first to sign in as someone else.`,
      );
    }
    const codeVerifier = randomBytes(32).toString("base64url");
    const state = this.pending.issue({ clientId: app.clientId, redirectUri, codeVerifier });
    const url = gitHubUrl(this.urls.web, "/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
      // Expiring tokens with a refresh token, even if the App's setting was turned off.
      scope: "offline_access",
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  /**
   * Exchanges the code GitHub sent the browser back with and keeps the user's tokens. Throws
   * `GitHubSignInFailed` with why.
   */
  async complete({ code, state, error }: SignInReturn): Promise<void> {
    const pending = this.pending.take(state);
    if (pending === undefined) {
      throw new GitHubSignInFailed(
        "This sign-in wasn't started from this Office, or took longer than ten minutes. Sign in again.",
      );
    }
    if (error !== undefined) throw new GitHubSignInFailed(refusalReason(error));
    if (code === undefined) {
      throw new GitHubSignInFailed("GitHub sent no sign-in code. Sign in again.");
    }
    const app = await this.appSignedInto(pending);
    const signInCode = {
      code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
    };
    const tokens = await this.exchange(app, signInCode);
    const login = await this.loginOf(tokens);
    await this.change(async () => {
      await this.appSignedInto(pending);
      await this.signIns.replace({ status: "signed-in", login, tokens });
      await this.events.publish(new GitHubSignedIn(login));
    });
  }

  /** Forgets the token. */
  async signOut(): Promise<void> {
    await this.change(async () => {
      await this.signIns.replace(undefined);
      await this.events.publish(new GitHubSignedOut(undefined));
    });
  }

  /** The App the sign-in was started with, still the one registered. */
  private async appSignedInto(pending: PendingSignIn): Promise<GitHubApp> {
    const app = await this.apps.read();
    if (app?.clientId !== pending.clientId) {
      throw new GitHubSignInFailed(
        "The GitHub App was registered again during the sign-in. Sign in again.",
      );
    }
    return app;
  }

  private async exchange(app: GitHubApp, code: SignInCode): Promise<UserTokens> {
    const answer = await this.api.exchangeSignInCode(app, code).catch(failedSignIn);
    if (answer.kind === "refused") throw new GitHubSignInFailed(refusalReason(answer.error));
    return answer.tokens;
  }

  private async loginOf(tokens: UserTokens): Promise<string> {
    return this.api.loginOf(tokens.accessToken).catch(failedSignIn);
  }

  /** Tokens issued under the App registered before won't refresh under the new one's Client ID. */
  private async forgetForNewApp(): Promise<void> {
    if ((await this.signIns.read())?.status !== "signed-in") {
      // A reason given under the App registered before no longer applies.
      await this.signIns.replace(undefined);
      return;
    }
    const reason = {
      text: "The GitHub App was registered again, so the sign-in under the one before ended. Sign in again.",
    };
    await this.signIns.replace({ status: "signed-out", reason });
    await this.events.publish(new GitHubSignedOut(reason));
  }

  private change(work: () => Promise<void>): Promise<void> {
    const next = this.changes.then(work);
    this.changes = next.catch(() => undefined);
    return next;
  }
}

function failedSignIn(error: unknown): never {
  if (error instanceof GitHubApiFailure) throw new GitHubSignInFailed(error.message);
  throw error;
}

/**
 * GitHub's `error` codes, sent the browser back with instead of a code or refusing a code's
 * exchange, in the user's words.
 */
function refusalReason(error: string): string {
  switch (error) {
    case "access_denied":
      return "The sign-in was cancelled on GitHub. Sign in again.";
    case "bad_verification_code":
      return "GitHub no longer knows this sign-in's code: a code is used once, within ten minutes. Sign in again.";
    case "incorrect_client_credentials":
      return "GitHub refused the App's Client ID and client secret: the App may have been deleted or its secret reset. Register the App again.";
    case "redirect_uri_mismatch":
      return "GitHub sends the browser back only to the address the App was registered from. Open The Office at that address and sign in again, or register the App again from this one.";
    case "unverified_user_email":
      return "GitHub asks for your primary email address to be verified first. Verify it on GitHub, then sign in again.";
    default:
      return `GitHub refused the sign-in (${error}). Sign in again.`;
  }
}
