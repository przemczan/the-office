import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubSignedOut } from "../domain/github-events.js";
import {
  GitHubAccessFailed,
  NotSignedInWithGitHub,
  type GitHubRepository,
} from "../domain/github-repository.js";
import { needsRefresh, usableRefreshToken, type KeptSignIn } from "../domain/sign-in.js";
import {
  GitHubApi,
  GitHubApiFailure,
  GitHubUnreachable,
  type TokenAnswer,
} from "../ports/github-api.js";
import { GitHubAppRepository } from "../ports/github-app-repository.js";
import { GitHubSignInRepository } from "../ports/github-sign-in-repository.js";
import { refusalReason } from "./github-sign-in.js";
import { SignInChanges } from "./sign-in-changes.js";

type SignedIn = Extract<KeptSignIn, { status: "signed-in" }>;

/**
 * GitHub as the signed-in user: their token for one command, refreshed first when it is about to
 * expire, and the repositories the App is installed on. A refresh GitHub refuses signs the user out,
 * saying why; the token before it is never used again, since GitHub has ended it.
 */
@Injectable()
export class GitHubAccess {
  constructor(
    private readonly api: GitHubApi,
    private readonly apps: GitHubAppRepository,
    private readonly signIns: GitHubSignInRepository,
    private readonly events: EventBus,
    private readonly changes: SignInChanges,
  ) {}

  /** Whether the user is signed in, without reading or refreshing the token. */
  async isSignedIn(): Promise<boolean> {
    return (await this.signIns.read())?.status === "signed-in";
  }

  /**
   * The user token for one command, or undefined while signed out, which a refused refresh makes
   * the user. Read in turn with refreshes and sign-in changes, so a caller waiting on a refresh gets
   * its token rather than the one it ended. Throws `GitHubAccessFailed` when GitHub can't be reached
   * to refresh it; the sign-in is kept, since GitHub may not have seen the refresh.
   */
  userToken(): Promise<string | undefined> {
    return this.changes.run(async () => {
      const kept = await this.signIns.read();
      if (kept?.status !== "signed-in") return undefined;
      return needsRefresh(kept.tokens, new Date()) ? this.refresh(kept) : kept.tokens.accessToken;
    });
  }

  /**
   * The repositories of the App's installations the user can reach. Throws
   * `NotSignedInWithGitHub` while signed out and `GitHubAccessFailed` when GitHub fails.
   */
  async repositories(): Promise<readonly GitHubRepository[]> {
    const token = await this.userToken();
    if (token === undefined) throw new NotSignedInWithGitHub();
    return this.api.repositoriesOf(token).catch(failedAccess);
  }

  private async refresh(signedIn: SignedIn): Promise<string | undefined> {
    const refreshToken = usableRefreshToken(signedIn.tokens, new Date());
    if (refreshToken === undefined) {
      return this.signOutBecause(
        "The sign-in to GitHub ended: it can't be renewed after six months unused. Sign in again.",
      );
    }
    const app = await this.apps.read();
    if (app === undefined) {
      return this.signOutBecause("The GitHub App is no longer registered. Register it again.");
    }
    let answer: TokenAnswer;
    try {
      answer = await this.api.refreshUserToken(app, refreshToken);
    } catch (error) {
      if (error instanceof GitHubUnreachable) {
        throw new GitHubAccessFailed(
          `${error.message}. The GitHub token couldn't be renewed; try again once GitHub can be reached.`,
        );
      }
      if (error instanceof GitHubApiFailure) return this.signOutBecause(error.message);
      throw error;
    }
    if (answer.kind === "refused") return this.signOutBecause(refreshRefusalReason(answer.error));
    await this.signIns.replace({ ...signedIn, tokens: answer.tokens });
    return answer.tokens.accessToken;
  }

  private async signOutBecause(text: string): Promise<undefined> {
    const reason = { text };
    await this.signIns.replace({ status: "signed-out", reason });
    await this.events.publish(new GitHubSignedOut(reason));
    return undefined;
  }
}

function failedAccess(error: unknown): never {
  if (error instanceof GitHubApiFailure) throw new GitHubAccessFailed(error.message);
  throw error;
}

/** GitHub's `error` codes refusing a refresh, in the user's words. */
function refreshRefusalReason(error: string): string {
  switch (error) {
    case "bad_refresh_token":
      return "GitHub no longer accepts the sign-in: it was revoked on GitHub, or went unused for six months. Sign in again.";
    case "incorrect_client_credentials":
      return refusalReason(error);
    default:
      return `GitHub refused to renew the sign-in (${error}). Sign in again.`;
  }
}
