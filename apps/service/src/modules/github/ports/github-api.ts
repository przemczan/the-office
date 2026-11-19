import type { GitHubApp } from "../domain/github-app.js";
import type { GitHubRepository } from "../domain/github-repository.js";
import type {
  GitHubMergeMethod,
  MergeSettingsOnGitHub,
  RefusalOnGitHub,
} from "../domain/merge-refusal.js";
import type { PullRequestToOpen, RepositoryOnGitHub } from "../domain/pull-request.js";
import type { ChecksOnGitHub } from "../domain/pull-request-status.js";
import type { UserTokens } from "../domain/sign-in.js";

/** A sign-in's code GitHub sent the browser back with, and what proves The Office asked for it. */
export interface SignInCode {
  readonly code: string;
  /** The `redirect_uri` the authorize request named. */
  readonly redirectUri: string;
  /** PKCE's secret, whose SHA-256 the authorize request sent as its `code_challenge`. */
  readonly codeVerifier: string;
}

/** A user on GitHub: their numeric id, which never changes, and their login, which can. */
export interface GitHubUser {
  readonly id: number;
  readonly login: string;
}

/**
 * GitHub's answer to a token request: the tokens, or its refusal by its `error` code (such as
 * `bad_verification_code` or `incorrect_client_credentials`), which the application words.
 */
export type TokenAnswer =
  | { readonly kind: "issued"; readonly tokens: UserTokens }
  | { readonly kind: "refused"; readonly error: string };

/** GitHub as The Office calls it. Each call throws `GitHubApiFailure` when GitHub can't be reached. */
export abstract class GitHubApi {
  /**
   * Exchanges the code GitHub redirected back with for the App it registered. Only what
   * `GitHubApp` keeps comes back; the private key and webhook secret in GitHub's answer go no
   * further than the adapter. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract convertManifestCode(code: string): Promise<GitHubApp>;

  /** Exchanges a sign-in's code for the user's tokens, with the App's client secret. */
  abstract exchangeSignInCode(app: GitHubApp, code: SignInCode): Promise<TokenAnswer>;

  /** The user the token belongs to. Also throws `GitHubApiFailure` when GitHub refuses. */
  abstract userOf(accessToken: string): Promise<GitHubUser>;

  /**
   * Revokes this one user token, with the App's client ID and secret; the user's authorization of
   * the App and their other tokens stay. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract revokeUserToken(app: GitHubApp, accessToken: string): Promise<void>;

  /**
   * Trades the refresh token for a new user token and refresh token, with the App's client secret.
   * Once GitHub has answered, the tokens before no longer work.
   */
  abstract refreshUserToken(app: GitHubApp, refreshToken: string): Promise<TokenAnswer>;

  /**
   * Every repository of the App's installations that the user can reach, every page of them. Also
   * throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract repositoriesOf(accessToken: string): Promise<readonly GitHubRepository[]>;

  /**
   * Every installation of the App the user can reach, suspended ones included, with the
   * permissions each granted. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract installationsOf(accessToken: string): Promise<readonly GitHubInstallation[]>;

  /** Opens the pull request as the token's user, or gives GitHub's refusal. */
  abstract openPullRequest(
    accessToken: string,
    pullRequest: PullRequestToOpen,
  ): Promise<PullRequestAnswer>;

  /**
   * The open pull request of `head`, a branch of the repository, into `base`, or undefined when
   * none is open. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract openPullRequestOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    head: string,
    base: string,
  ): Promise<PullRequestOnGitHub | undefined>;

  /**
   * Every open pull request of the repository, every page of them. Also throws `GitHubApiFailure`
   * when GitHub refuses.
   */
  abstract openPullRequestsOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
  ): Promise<readonly ListedPullRequest[]>;

  /** Pull request `number` of the repository. Also throws `GitHubApiFailure` when GitHub refuses. */
  abstract pullRequestOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
  ): Promise<PullRequestDetail>;

  /**
   * The check runs and commit statuses of commit `sha`; unreadable, never a failure, when GitHub
   * refuses to show them (403 or 404). Throws `GitHubApiFailure` when GitHub fails otherwise.
   */
  abstract checksOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    sha: string,
  ): Promise<ChecksOnGitHub>;

  /**
   * The repository's merge settings. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract repositoryOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
  ): Promise<MergeSettingsOnGitHub>;

  /**
   * Merges pull request `number` as the token's user, or gives GitHub's refusal; never deletes its
   * branch. Throws `GitHubUnreachable` when GitHub can't be reached.
   */
  abstract mergePullRequest(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
    merge: PullRequestMerge,
  ): Promise<MergeAnswer>;

  /**
   * Closes pull request `number` without merging it, or gives GitHub's refusal. Throws
   * `GitHubUnreachable` when GitHub can't be reached.
   */
  abstract closePullRequest(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
  ): Promise<RefusalOnGitHub | undefined>;
}

/** A merge as GitHub is asked for it: the method, and the head commit it must still be at. */
export interface PullRequestMerge {
  readonly method: GitHubMergeMethod;
  readonly sha: string;
  /** The squashed commit's title and message; GitHub's own when left out. */
  readonly commitTitle?: string;
  readonly commitMessage?: string;
}

/** GitHub's answer to a merge: the commit it made on the base, or its refusal. */
export type MergeAnswer =
  | { readonly kind: "merged"; readonly sha: string }
  | ({ readonly kind: "refused" } & RefusalOnGitHub);

/** A pull request on GitHub, by its number in the repository and its web address. */
export interface PullRequestOnGitHub {
  readonly number: number;
  readonly url: string;
}

/** An open pull request as GitHub lists it: `head` into `base`, and the commit each is at. */
export interface ListedPullRequest extends PullRequestOnGitHub {
  readonly title: string;
  readonly head: string;
  readonly base: string;
  readonly headSha: string;
  readonly baseSha: string;
}

/** One pull request as GitHub gives it on its own. */
export interface PullRequestDetail {
  readonly title: string;
  /** Markdown; empty when it has none. */
  readonly body: string;
  readonly state: "open" | "closed";
  /** When it was merged; null when it wasn't. */
  readonly mergedAt: string | null;
  /** Null while GitHub is still working it out. */
  readonly mergeable: boolean | null;
  readonly headSha: string;
  readonly baseSha: string;
}

/** An installation of the App, as the user's token reaches it. */
export interface GitHubInstallation {
  readonly id: number;
  readonly suspended: boolean;
  /** The login of the account it is installed on. */
  readonly account: string;
  /** `User` or `Organization`, as GitHub names the account's kind. */
  readonly accountType: string;
  /** The permissions it granted, by GitHub's names and levels (`read`, `write`, `admin`). */
  readonly permissions: Readonly<Record<string, string>>;
  /** Its page on GitHub, where its owner accepts new permissions. */
  readonly url: string;
}

/**
 * GitHub's answer to opening a pull request: the pull request, or the status it refused with and
 * the messages of its validation errors, which GitHub writes for the user.
 */
export type PullRequestAnswer =
  | ({ readonly kind: "opened" } & PullRequestOnGitHub)
  | { readonly kind: "refused"; readonly status: number; readonly reasons: readonly string[] };

/** A call to GitHub that failed, in the UI's words; never holding GitHub's answer, which may carry secrets. */
export class GitHubApiFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubApiFailure";
  }
}

/** A call that got no answer from GitHub, so GitHub may not have seen it. */
export class GitHubUnreachable extends GitHubApiFailure {
  constructor(message: string) {
    super(message);
    this.name = "GitHubUnreachable";
  }
}
