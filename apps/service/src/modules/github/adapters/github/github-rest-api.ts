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
import {
  GitHubApi,
  GitHubApiFailure,
  GitHubUnreachable,
  type PullRequestAnswer,
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

const userSchema = z.object({ login: z.string().min(1) });

const installationsPageSchema = z.object({
  installations: z.array(z.object({ id: z.number(), suspended_at: z.string().nullish() })),
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

const pullRequestSchema = z.object({ html_url: z.string().min(1) });

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

  async loginOf(accessToken: string): Promise<string> {
    const response = await this.call(gitHubUrl(this.urls.api, "/user"), {
      headers: { ...REST_HEADERS, authorization: `Bearer ${accessToken}` },
    });
    const parsed = userSchema.safeParse(await response.json().catch(() => undefined));
    if (response.status !== 200 || !parsed.success) {
      throw new GitHubApiFailure(
        `GitHub didn't say who signed in (HTTP ${response.status}). Sign in again.`,
      );
    }
    return parsed.data.login;
  }

  async repositoriesOf(accessToken: string): Promise<readonly GitHubRepository[]> {
    // docs.github.com/rest/apps/installations, "accessible to the user access token".
    const installations = await this.everyPage(
      "/user/installations",
      accessToken,
      (body) => installationsPageSchema.safeParse(body).data?.installations,
    );
    const repositories: GitHubRepository[] = [];
    // A suspended installation's repositories can't be reached with the user's token.
    for (const { id } of installations.filter((installation) => !installation.suspended_at)) {
      const page = await this.everyPage(
        `/user/installations/${id}/repositories`,
        accessToken,
        (body) => repositoriesPageSchema.safeParse(body).data?.repositories,
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
    return { kind: "opened", url: opened.data.html_url };
  }

  async openPullRequestOf(
    accessToken: string,
    repository: RepositoryOnGitHub,
    head: string,
    base: string,
  ): Promise<string | undefined> {
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
    return listed.data[0]?.html_url;
  }

  /**
   * Every page of a list, following the `Link` header's `next` until there is none
   * (docs.github.com/rest/using-the-rest-api/using-pagination-in-the-rest-api).
   */
  private async everyPage<T>(
    path: string,
    accessToken: string,
    itemsOf: (body: unknown) => T[] | undefined,
  ): Promise<T[]> {
    const items: T[] = [];
    let url: URL | undefined = gitHubUrl(this.urls.api, path);
    url.searchParams.set("per_page", PAGE_SIZE);
    while (url !== undefined) {
      const response = await this.call(url, {
        headers: { ...REST_HEADERS, authorization: `Bearer ${accessToken}` },
      });
      const page =
        response.status === 200 ? itemsOf(await response.json().catch(() => undefined)) : undefined;
      if (page === undefined) {
        throw new GitHubApiFailure(
          `GitHub didn't list the repositories the App is installed on (HTTP ${response.status}).`,
        );
      }
      items.push(...page);
      url = this.nextPageOf(response);
    }
    return items;
  }

  /** The next page's URL, only on the API's own origin, so the token goes nowhere else. */
  private nextPageOf(response: Response): URL | undefined {
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
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

function pullsPathOf({ owner, name }: RepositoryOnGitHub): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
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
