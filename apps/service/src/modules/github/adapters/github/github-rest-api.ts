import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { gitHubUrl, GitHubUrls } from "../../application/github-urls.js";
import type { GitHubApp } from "../../domain/github-app.js";
import type { GitHubRepository } from "../../domain/github-repository.js";
import {
  fullNameOf,
  type PullRequestToOpen,
  type RepositoryOnGitHub,
} from "../../domain/pull-request.js";
import type { MergeSettingsOnGitHub, RefusalOnGitHub } from "../../domain/merge-refusal.js";
import type { ChecksOnGitHub } from "../../domain/pull-request-status.js";
import {
  GitHubApi,
  GitHubApiFailure,
  GitHubUnreachable,
  type GitHubInstallation,
  type GitHubUser,
  type ListedPullRequest,
  type MergeAnswer,
  type PullRequestMerge,
  type PullRequestAnswer,
  type PullRequestDetail,
  type PullRequestOnGitHub,
  type SignInCode,
  type TokenAnswer,
} from "../../ports/github-api.js";

const REST_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

/** GitHub's largest page. */
const PAGE_SIZE = "100";

/** A call GitHub hasn't answered by then is given up, so a refresh can't hold up every git command. */
const CALL_TIMEOUT_MS = 30_000;

/**
 * The part of the manifest conversion's answer that is kept. zod drops every other key, so the
 * private key and webhook secret leave this file in no value.
 */
const convertedAppSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  slug: z.string().min(1),
  // A user's or organization's login; an enterprise owner has a slug instead.
  owner: z.union([z.object({ login: z.string().min(1) }), z.object({ slug: z.string().min(1) })]),
});

const refusalSchema = z.object({ error: z.string().min(1) });

/** The tokens GitHub hands out; the expiries and the refresh token are left out when tokens don't expire. */
const userTokensSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});

const userSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1) });

const installationsPageSchema = z.object({
  installations: z.array(
    z.object({
      id: z.number(),
      suspended_at: z.string().nullish(),
      // An enterprise's installation names its account by slug, without a login.
      account: z
        .object({
          login: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
          type: z.string().optional(),
        })
        .nullish(),
      permissions: z.record(z.string(), z.string()).optional(),
      html_url: z.string().min(1),
    }),
  ),
});

const repositoriesPageSchema = z.object({
  repositories: z.array(
    z.object({
      full_name: z.string().min(1),
      clone_url: z.string().min(1),
      private: z.boolean(),
      default_branch: z.string().min(1),
      pushed_at: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().min(1),
});

const commitOfSchema = z.object({ ref: z.string().min(1), sha: z.string().min(1) });

const listedPullRequestSchema = pullRequestSchema.extend({
  title: z.string(),
  head: commitOfSchema,
  base: commitOfSchema,
});

const pullRequestDetailSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(["open", "closed"]),
  merged_at: z.string().nullish(),
  mergeable: z.boolean().nullish(),
  head: commitOfSchema,
  base: commitOfSchema,
});

const checkRunsPageSchema = z.object({
  check_runs: z.array(z.object({ status: z.string(), conclusion: z.string().nullish() })),
});

const combinedStatusSchema = z.object({ statuses: z.array(z.object({ state: z.string() })) });

/** A repository's merge settings; GitHub gives them only to those who may change them. */
const repositorySchema = z.object({
  allow_merge_commit: z.boolean().optional(),
  allow_squash_merge: z.boolean().optional(),
  allow_rebase_merge: z.boolean().optional(),
  delete_branch_on_merge: z.boolean().optional(),
});

const mergedSchema = z.object({ sha: z.string().min(1) });

/** A refusal's `message`, which GitHub writes for the user, such as "Pull Request is not mergeable". */
const refusalMessageSchema = z.object({ message: z.string() });

/** How many answers the conditional requests keep, the oldest read dropped first. */
const CACHED_ANSWERS = 500;

/** An answer kept for its ETag: what was parsed of its body, and its `Link` header. */
interface CachedAnswer {
  readonly etag: string;
  readonly parsed: unknown;
  readonly link: string | null;
}

/** A GET's answer: its status and, on a 200 (or a 304 the cache answered), its parsed body. */
interface ReadAnswer<T> {
  readonly status: number;
  readonly parsed: T | undefined;
  readonly link: string | null;
}

/** GitHub refused a read with `status`; the message names the status only. */
class GitHubRefusedRead extends GitHubApiFailure {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubRefusedRead";
  }
}

/** A 422's body: `errors`, each with a `message` when GitHub words it, such as "A pull request already exists for …". */
const validationErrorsSchema = z.object({
  errors: z.array(z.object({ message: z.string().min(1).optional() })),
});

/**
 * GitHub's REST API (docs.github.com/rest) and the token endpoint on its website
 * (docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
 * on the base URLs The Office is given.
 */
@Injectable()
export class GitHubRestApi extends GitHubApi {
  /**
   * The answers to reads, by token and URL, for conditional requests
   * (docs.github.com/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate):
   * a 304 doesn't count against the rate limit, so a list read every few seconds costs little.
   * Keyed by the token's hash, so no token sits in a key.
   */
  private readonly answers = new Map<string, CachedAnswer>();

  constructor(private readonly urls: GitHubUrls) {
    super();
  }

  async convertManifestCode(code: string): Promise<GitHubApp> {
    const url = gitHubUrl(this.urls.api, `/app-manifests/${encodeURIComponent(code)}/conversions`);
    const response = await this.call(url, { method: "POST", headers: REST_HEADERS });
    if (response.status !== 201) {
      throw new GitHubApiFailure(conversionRefusal(response.status));
    }
    const parsed = convertedAppSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new GitHubApiFailure(
        "GitHub's answer didn't name the App's Client ID, client secret, slug and owner. Register the App again.",
      );
    }
    const { client_id: clientId, client_secret: clientSecret, slug, owner } = parsed.data;
    return { clientId, clientSecret, slug, owner: "login" in owner ? owner.login : owner.slug };
  }

  async exchangeSignInCode(app: GitHubApp, signIn: SignInCode): Promise<TokenAnswer> {
    // Sent in the body, never the URL, so neither the secret nor the code reaches a log of URLs.
    const response = await this.call(gitHubUrl(this.urls.web, "/login/oauth/access_token"), {
      method: "POST",
      // Without it, GitHub answers form-encoded.
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code: signIn.code,
        redirect_uri: signIn.redirectUri,
        code_verifier: signIn.codeVerifier,
      }),
    });
    return tokenAnswerOf(response, "the sign-in");
  }

  async refreshUserToken(app: GitHubApp, refreshToken: string): Promise<TokenAnswer> {
    // docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
    const response = await this.call(gitHubUrl(this.urls.web, "/login/oauth/access_token"), {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    return tokenAnswerOf(response, "renewing the sign-in");
  }

  async userOf(accessToken: string): Promise<GitHubUser> {
    const response = await this.call(gitHubUrl(this.urls.api, "/user"), {
      headers: { ...REST_HEADERS, authorization: `Bearer ${accessToken}` },
    });
    const parsed = userSchema.safeParse(await response.json().catch(() => undefined));
    if (response.status !== 200 || !parsed.success) {
      throw new GitHubApiFailure(
        `GitHub didn't say who signed in (HTTP ${response.status}). Sign in again.`,
      );
    }
    return parsed.data;
  }

  async revokeUserToken(app: GitHubApp, accessToken: string): Promise<void> {
    // docs.github.com/rest/apps/oauth-applications#delete-an-app-token: this token only, never
    // `/grant`, which would end every token of the user's, the git identity's among them.
    const credentials = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
    const response = await this.call(
      gitHubUrl(this.urls.api, `/applications/${encodeURIComponent(app.clientId)}/token`),
      {
        method: "DELETE",
        headers: {
          ...REST_HEADERS,
          authorization: `Basic ${credentials}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
    if (response.status !== 204) {
      throw new GitHubApiFailure(`GitHub didn't revoke the token (HTTP ${response.status}).`);
    }
  }

  async installationsOf(accessToken: string): Promise<readonly GitHubInstallation[]> {
    // docs.github.com/rest/apps/installations, "accessible to the user access token".
    const installations = await this.everyPage(
      gitHubUrl(this.urls.api, "/user/installations"),
      accessToken,
      (body) => installationsPageSchema.safeParse(body).data?.installations,
      "GitHub didn't list the installations of the GitHub App",
    );
    return installations.map((installation) => ({
      id: installation.id,
      suspended: Boolean(installation.suspended_at),
      account:
        installation.account?.login ??
        installation.account?.slug ??
        `installation ${installation.id}`,
      accountType: installation.account?.type ?? "",
      permissions: installation.permissions ?? {},
      url: installation.html_url,
    }));
  }

  async repositoriesOf(accessToken: string): Promise<readonly GitHubRepository[]> {
    const installations = await this.installationsOf(accessToken);
    const repositories: GitHubRepository[] = [];
    // A suspended installation's repositories can't be reached with the user's token.
    for (const { id } of installations.filter((installation) => !installation.suspended)) {
      const page = await this.everyPage(
        gitHubUrl(this.urls.api, `/user/installations/${id}/repositories`),
        accessToken,
        (body) => repositoriesPageSchema.safeParse(body).data?.repositories,
        "GitHub didn't list the repositories the App is installed on",
      );
      repositories.push(
        ...page.map((repository) => ({
          fullName: repository.full_name,
          repositoryUrl: repository.clone_url,
          private: repository.private,
          defaultBranch: repository.default_branch,
          pushedAt: repository.pushed_at ?? null,
          description: repository.description ?? "",
        })),
      );
    }
    return repositories.toSorted((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async openPullRequest(
    accessToken: string,
    pullRequest: PullRequestToOpen,
  ): Promise<PullRequestAnswer> {
    const { repository, base, head, title, body } = pullRequest;
    // docs.github.com/rest/pulls/pulls#create-a-pull-request
    const response = await this.call(gitHubUrl(this.urls.api, pullsPathOf(repository)), {
      method: "POST",
      headers: {
        ...REST_HEADERS,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title, head, base, body }),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    if (response.status !== 201) {
      return { kind: "refused", status: response.status, reasons: validationReasonsOf(answer) };
    }
    const opened = pullRequestSchema.safeParse(answer);
    if (!opened.success) {
      throw new GitHubApiFailure("GitHub's answer held no pull request (HTTP 201).");
    }
    return { kind: "opened", number: opened.data.number, url: opened.data.html_url };
  }

  async openPullRequestOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    head: string,
    base: string,
  ): Promise<PullRequestOnGitHub | undefined> {
    // docs.github.com/rest/pulls/pulls#list-pull-requests: `head` is `owner:branch`.
    const url = gitHubUrl(this.urls.api, pullsPathOf(repository));
    url.searchParams.set("state", "open");
    url.searchParams.set("head", `${repository.owner}:${head}`);
    url.searchParams.set("base", base);
    const response = await this.call(url, {
      headers: { ...REST_HEADERS, authorization: `Bearer ${accessToken}` },
    });
    const listed = z
      .array(pullRequestSchema)
      .safeParse(await response.json().catch(() => undefined));
    if (response.status !== 200 || !listed.success) {
      throw new GitHubApiFailure(
        `GitHub didn't list the open pull requests of ${fullNameOf(repository)} (HTTP ${response.status}).`,
      );
    }
    const found = listed.data[0];
    return found && { number: found.number, url: found.html_url };
  }

  async openPullRequestsOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
  ): Promise<readonly ListedPullRequest[]> {
    // docs.github.com/rest/pulls/pulls#list-pull-requests
    const url = gitHubUrl(this.urls.api, pullsPathOf(repository));
    url.searchParams.set("state", "open");
    const listed = await this.everyPage(
      url,
      accessToken,
      (body) => z.array(listedPullRequestSchema).safeParse(body).data,
      `GitHub didn't list the open pull requests of ${fullNameOf(repository)}`,
    );
    return listed.map((pullRequest) => ({
      number: pullRequest.number,
      url: pullRequest.html_url,
      title: pullRequest.title,
      head: pullRequest.head.ref,
      base: pullRequest.base.ref,
      headSha: pullRequest.head.sha,
      baseSha: pullRequest.base.sha,
    }));
  }

  async pullRequestOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
  ): Promise<PullRequestDetail> {
    // docs.github.com/rest/pulls/pulls#get-a-pull-request
    const url = gitHubUrl(this.urls.api, `${pullsPathOf(repository)}/${number}`);
    const answer = await this.read(
      url,
      accessToken,
      (body) => pullRequestDetailSchema.safeParse(body).data,
    );
    if (answer.parsed === undefined) {
      throw new GitHubApiFailure(
        `GitHub didn't give pull request #${number} of ${fullNameOf(repository)} (HTTP ${answer.status}).`,
      );
    }
    const { title, body, state, merged_at: mergedAt, mergeable, head, base } = answer.parsed;
    return {
      title,
      body: body ?? "",
      state,
      mergedAt: mergedAt ?? null,
      mergeable: mergeable ?? null,
      headSha: head.sha,
      baseSha: base.sha,
    };
  }

  async checksOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    sha: string,
  ): Promise<ChecksOnGitHub> {
    const commitPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`;
    try {
      // docs.github.com/rest/checks/runs#list-check-runs-for-a-git-reference: by default the latest
      // run of each check only, so a re-run that passed replaces the failure before it.
      const runs = await this.everyPage(
        gitHubUrl(this.urls.api, `${commitPath}/check-runs`),
        accessToken,
        (body) => checkRunsPageSchema.safeParse(body).data?.check_runs,
        `GitHub didn't list the checks of ${fullNameOf(repository)} at ${sha}`,
      );
      // docs.github.com/rest/commits/statuses#get-the-combined-status-for-a-specific-reference:
      // its `statuses`, the latest of each context, rather than its `state`, which is `pending`
      // for a commit with no status at all.
      const statusUrl = gitHubUrl(this.urls.api, `${commitPath}/status`);
      statusUrl.searchParams.set("per_page", PAGE_SIZE);
      const combined = await this.read(
        statusUrl,
        accessToken,
        (body) => combinedStatusSchema.safeParse(body).data?.statuses,
      );
      if (combined.parsed === undefined) {
        throw new GitHubRefusedRead(
          `GitHub didn't give the commit statuses of ${fullNameOf(repository)} at ${sha} (HTTP ${combined.status}).`,
          combined.status,
        );
      }
      return {
        kind: "read",
        runs: runs.map((run) => ({ status: run.status, conclusion: run.conclusion ?? null })),
        statuses: combined.parsed,
      };
    } catch (error) {
      // An installation without the Checks or Commit statuses permission is refused them.
      if (error instanceof GitHubRefusedRead && (error.status === 403 || error.status === 404)) {
        return { kind: "unreadable" };
      }
      throw error;
    }
  }

  async repositoryOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
  ): Promise<MergeSettingsOnGitHub> {
    // docs.github.com/rest/repos/repos#get-a-repository
    const url = gitHubUrl(this.urls.api, repositoryPathOf(repository));
    const answer = await this.read(
      url,
      accessToken,
      (body) => repositorySchema.safeParse(body).data,
    );
    if (answer.parsed === undefined) {
      throw new GitHubApiFailure(
        `GitHub didn't give ${fullNameOf(repository)} (HTTP ${answer.status}).`,
      );
    }
    const settings = answer.parsed;
    return {
      allowMergeCommit: settings.allow_merge_commit,
      allowSquashMerge: settings.allow_squash_merge,
      allowRebaseMerge: settings.allow_rebase_merge,
      deleteBranchOnMerge: settings.delete_branch_on_merge,
    };
  }

  async mergePullRequest(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
    { method, sha, commitTitle, commitMessage }: PullRequestMerge,
  ): Promise<MergeAnswer> {
    // docs.github.com/rest/pulls/pulls#merge-a-pull-request: `sha` makes GitHub refuse (409) a head
    // that moved since. The branch is never deleted.
    const url = gitHubUrl(this.urls.api, `${pullsPathOf(repository)}/${number}/merge`);
    const response = await this.call(url, {
      method: "PUT",
      headers: this.writeHeaders(accessToken),
      body: JSON.stringify({
        merge_method: method,
        sha,
        ...(commitTitle !== undefined && { commit_title: commitTitle }),
        ...(commitMessage !== undefined && { commit_message: commitMessage }),
      }),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    if (response.status !== 200) {
      return { kind: "refused", status: response.status, message: refusalMessageOf(answer) };
    }
    const merged = mergedSchema.safeParse(answer);
    if (!merged.success) {
      throw new GitHubApiFailure("GitHub's answer to the merge held no commit (HTTP 200).");
    }
    return { kind: "merged", sha: merged.data.sha };
  }

  async closePullRequest(
    accessToken: string,
    repository: RepositoryOnGitHub,
    number: number,
  ): Promise<RefusalOnGitHub | undefined> {
    // docs.github.com/rest/pulls/pulls#update-a-pull-request
    const url = gitHubUrl(this.urls.api, `${pullsPathOf(repository)}/${number}`);
    const response = await this.call(url, {
      method: "PATCH",
      headers: this.writeHeaders(accessToken),
      body: JSON.stringify({ state: "closed" }),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    if (response.status === 200) return undefined;
    return { status: response.status, message: refusalMessageOf(answer) };
  }

  private writeHeaders(accessToken: string): Record<string, string> {
    return {
      ...REST_HEADERS,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    };
  }

  /**
   * Every page of a list, following the `Link` header's `next` until there is none
   * (docs.github.com/rest/using-the-rest-api/using-pagination-in-the-rest-api). `failure` says
   * what wasn't listed, GitHub's status added.
   */
  private async everyPage<T>(
    first: URL,
    accessToken: string,
    itemsOf: (body: unknown) => T[] | undefined,
    failure: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let url: URL | undefined = new URL(first);
    url.searchParams.set("per_page", PAGE_SIZE);
    while (url !== undefined) {
      const page = await this.read(url, accessToken, itemsOf);
      if (page.parsed === undefined) {
        throw new GitHubRefusedRead(`${failure} (HTTP ${page.status}).`, page.status);
      }
      items.push(...page.parsed);
      url = this.nextPageOf(page.link);
    }
    return items;
  }

  /**
   * A GET as the token's user, conditional on the ETag of the answer it had before: on a 304 that
   * answer is given again. `parse` gives undefined for a body it can't read, which a 200 isn't
   * kept with; only what it parsed is kept, never the whole body.
   */
  private async read<T>(
    url: URL,
    accessToken: string,
    parse: (body: unknown) => T | undefined,
  ): Promise<ReadAnswer<T>> {
    const key = `${createHash("sha256").update(accessToken).digest("base64url")} ${url.href}`;
    const cached = this.answers.get(key);
    const response = await this.call(url, {
      headers: {
        ...REST_HEADERS,
        authorization: `Bearer ${accessToken}`,
        ...(cached && { "if-none-match": cached.etag }),
      },
    });
    if (response.status === 304 && cached !== undefined) {
      this.keep(key, cached);
      // Parsed by the same `parse`: the key holds the URL, and each URL is read one way.
      return { status: 200, parsed: cached.parsed as T, link: cached.link };
    }
    const link = response.headers.get("link");
    if (response.status !== 200) return { status: response.status, parsed: undefined, link };
    const parsed = parse(await response.json().catch(() => undefined));
    const etag = response.headers.get("etag");
    if (parsed !== undefined && etag !== null) this.keep(key, { etag, parsed, link });
    return { status: 200, parsed, link };
  }

  /** Keeps the answer as the newest read, dropping the oldest read beyond `CACHED_ANSWERS`. */
  private keep(key: string, answer: CachedAnswer): void {
    this.answers.delete(key);
    this.answers.set(key, answer);
    for (const oldest of this.answers.keys()) {
      if (this.answers.size <= CACHED_ANSWERS) break;
      this.answers.delete(oldest);
    }
  }

  /** The next page's URL, only on the API's own origin, so the token goes nowhere else. */
  private nextPageOf(link: string | null): URL | undefined {
    const next = /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1];
    if (next === undefined) return undefined;
    const url = new URL(next);
    if (url.origin !== new URL(this.urls.api).origin) {
      throw new GitHubApiFailure(`GitHub's next page is on another address (${url.origin}).`);
    }
    return url;
  }

  private async call(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch (error) {
      throw new GitHubUnreachable(
        `GitHub couldn't be reached at ${url.origin}: ${reasonOf(error)}`,
      );
    }
  }
}

/**
 * GitHub's answer at its token endpoint: the tokens, or its refusal in an `error` field, which it
 * gives whatever the status. Without one, a server error or rate limit says GitHub couldn't answer
 * now, which ends no sign-in: the refresh token was most likely never used.
 */
async function tokenAnswerOf(response: Response, askedFor: string): Promise<TokenAnswer> {
  const body: unknown = await response.json().catch(() => undefined);
  const refusal = refusalSchema.safeParse(body);
  if (refusal.success) return { kind: "refused", error: refusal.data.error };
  if (response.status >= 500 || response.status === 429) {
    throw new GitHubUnreachable(`GitHub couldn't answer ${askedFor} (HTTP ${response.status})`);
  }
  const parsed = userTokensSchema.safeParse(body);
  if (response.status !== 200 || !parsed.success) {
    throw new GitHubApiFailure(
      `GitHub's answer to ${askedFor} held no token (HTTP ${response.status}). Sign in again.`,
    );
  }
  const tokens = parsed.data;
  return {
    kind: "issued",
    tokens: {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: secondsFromNow(tokens.expires_in),
      refreshToken: tokens.refresh_token,
      refreshTokenExpiresAt: secondsFromNow(tokens.refresh_token_expires_in),
    },
  };
}

function repositoryPathOf({ owner, name }: RepositoryOnGitHub): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function pullsPathOf(repository: RepositoryOnGitHub): string {
  return `${repositoryPathOf(repository)}/pulls`;
}

/** A refusal's `message`, which GitHub writes for the user; nothing else of its body. */
function refusalMessageOf(answer: unknown): string | undefined {
  return refusalMessageSchema.safeParse(answer).data?.message;
}

/** The messages of a refusal's validation errors, which GitHub writes for the user; nothing else of its body. */
function validationReasonsOf(answer: unknown): readonly string[] {
  return (validationErrorsSchema.safeParse(answer).data?.errors ?? []).flatMap((error) =>
    error.message === undefined ? [] : [error.message],
  );
}

function secondsFromNow(seconds: number | undefined): Date | undefined {
  return seconds === undefined ? undefined : new Date(Date.now() + seconds * 1000);
}

function conversionRefusal(status: number): string {
  if (status === 404) {
    return "GitHub no longer knows this registration code: a code is used once, within an hour. Register the App again.";
  }
  return `GitHub refused the registration code (HTTP ${status}). Register the App again.`;
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // fetch reports "fetch failed" and puts the network's reason in its cause.
  return error.cause instanceof Error ? error.cause.message : error.message;
}
