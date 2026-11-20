import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { GITHUB_ED25519 } from "../../../../platform/git-identity/fake-github-meta.fixtures.js";
import type { GitHubUrls } from "../../application/github-urls.js";
import { FakeInstallations, type ApiAnswer } from "./fake-github-installations.fixtures.js";
import { FakeIssues, issueControlSchema } from "./fake-github-issues.fixtures.js";
import { FakePullRequests, pullRequestControlSchema } from "./fake-github-pulls.fixtures.js";
import { FakeWorkflowRuns, runControlSchema } from "./fake-github-runs.fixtures.js";
import { FakeWorkflows, workflowControlSchema } from "./fake-github-workflows.fixtures.js";

/**
 * The secrets the fake hands out with each App: the private key and webhook secret, which tests
 * check The Office never keeps, and the client secret, which it keeps but never shows.
 */
export const FAKE_GITHUB_SECRETS = {
  pem: "-----BEGIN RSA PRIVATE KEY-----\nfake-private-key\n-----END RSA PRIVATE KEY-----\n",
  clientSecret: "fake-client-secret-0123456789abcdef",
  webhookSecret: "fake-webhook-secret-0123456789",
} as const;

/** What tokens the fake hands out start with, so tests can look for any of them. */
export const FAKE_TOKEN_PREFIXES = ["ghu_fake", "ghr_fake"] as const;

export interface FakeGitHubApp {
  readonly clientId: string;
  readonly slug: string;
  readonly owner: string;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** The query, with its `?`, or empty. */
  readonly search: string;
  readonly accept: string | undefined;
  /** A token request's `grant_type`, so tests tell refreshes from code exchanges; nothing else of a body. */
  readonly grantType: string | undefined;
}

/** The REST API's base path on the fake, so a client that drops its base's path is caught. */
const API_PATH = "/api/v3";

/**
 * Not GitHub's: where a test running the fake as a program of its own installs the App, since it
 * reaches the fake only over HTTP. A JSON body of `installationRequestSchema`; answers 204.
 */
export const FAKE_INSTALLATIONS_CONTROL_PATH = "/_fake/installations";

/**
 * Not GitHub's: where such a test changes a pull request as pushing, CI, merging or closing would
 * on GitHub. A JSON body of `pullRequestControlSchema`, by its `action`; answers 204, or 404 for a
 * pull request the fake didn't open.
 */
export const FAKE_PULL_REQUESTS_CONTROL_PATH = "/_fake/pull-requests";

/**
 * Not GitHub's: where such a test has an account's installations accept permissions. A JSON body
 * `{ account, permissions: { name: "read" | "write" | "admin" } }`; answers 204, or 404 for an
 * account the App isn't installed on.
 */
export const FAKE_PERMISSIONS_CONTROL_PATH = "/_fake/permissions";

/**
 * Not GitHub's: where such a test adds and changes GitHub Actions runs. A JSON body of
 * `runControlSchema`, by its `action`; answers 204, or 404 for a run the fake doesn't have.
 */
export const FAKE_RUNS_CONTROL_PATH = "/_fake/runs";

/**
 * Not GitHub's: where such a test adds workflows and branches or tags. A JSON body of
 * `workflowControlSchema`, by its `action`, answering 204; a GET answers the dispatches accepted.
 */
export const FAKE_WORKFLOWS_CONTROL_PATH = "/_fake/workflows";

/**
 * Not GitHub's: where such a test adds and changes issues. A JSON body of `issueControlSchema`, by
 * its `action`, answering 204; a GET answers the comments and closes taken.
 */
export const FAKE_ISSUES_CONTROL_PATH = "/_fake/issues";

const permissionLevelsSchema = z.record(z.string(), z.enum(["read", "write", "admin"]));

const installationRequestSchema = z.object({
  account: z.string().min(1),
  accountType: z.enum(["User", "Organization"]).optional(),
  permissions: permissionLevelsSchema.optional(),
  repositories: z.array(
    z.object({
      fullName: z.string().min(1),
      private: z.boolean().optional(),
      pushedAt: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
});

const grantRequestSchema = z.object({
  account: z.string().min(1),
  permissions: permissionLevelsSchema,
});

/** GitHub's own limit on a sign-in's code. */
const SIGN_IN_CODE_MS = 10 * 60 * 1000;

/** An App registered from a manifest, as GitHub keeps it. */
interface RegisteredApp extends FakeGitHubApp {
  readonly clientSecret: string;
  readonly callbackUrls: readonly string[];
}

/** A refresh token handed out, until it is used: who it is for and the user token handed out with it. */
interface IssuedRefreshToken {
  readonly login: string;
  readonly accessToken: string;
}

/** A sign-in's code GitHub sent the browser back with, until it is exchanged. */
interface SignInCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string | undefined;
  readonly login: string;
  readonly expiresAt: number;
}

/**
 * GitHub on 127.0.0.1, as far as The Office uses it: the page that registers an App from a
 * manifest and the REST API converting its code; the authorize page and token endpoint of an
 * App's web sign-in and the refresh of its tokens; `GET /user`, and the installations and their
 * repositories a user token reaches, with the permissions each installation granted, the pull
 * requests of those repositories and their commits' checks, and the ssh host
 * keys `GET /meta` publishes (GitHub's own). One server is both bases of `urls`. Behaves as
 * docs.github.com describes; where the docs are silent, as noted at each place.
 */
export class FakeGitHub {
  /** Every request, in order. */
  readonly requests: RecordedRequest[] = [];
  /**
   * The conditional requests answered 304 Not Modified, in order: GitHub's pull requests, a pull
   * request, and a commit's check runs and status answer with an ETag, and a 304 when the request's
   * `If-None-Match` names it.
   */
  readonly notModified: RecordedRequest[] = [];
  /** The manifests posted to the new-App page, parsed, in order. */
  readonly postedManifests: unknown[] = [];
  /** Every token handed out, so tests can check none reaches the web. */
  readonly issuedTokens: string[] = [];
  /** The user tokens revoked by `DELETE /applications/{client_id}/token`, in order. */
  readonly revokedTokens: string[] = [];
  /** The `scope` each visit to the authorize page asked for, null when it named none. */
  readonly authorizeScopes: (string | null)[] = [];
  /** Who authorizes on GitHub's authorize page; GitHub's own page would ask them. */
  signedInUser = "office-user";
  /** Whether the user cancels on the authorize page instead of authorizing. */
  cancelAuthorization = false;
  /** Whether the token endpoint fails as GitHub's does when it is down: HTTP 503, an HTML page. */
  tokenEndpointDown = false;
  /** The App's installations, which tests add to. */
  readonly installations: FakeInstallations;
  /** The pull requests opened on the installed repositories. */
  readonly pullRequests: FakePullRequests;
  /** The GitHub Actions runs: `addRun`, `setRun`; their list answers with an ETag and 304. */
  readonly runs: FakeWorkflowRuns;
  /**
   * The workflows, their files by ref, the branches and tags: `addWorkflow`, `addRef`; a dispatch
   * queues a run in `runs` and is recorded in `dispatches()`.
   */
  readonly workflows: FakeWorkflows;
  /**
   * The issues, pull requests among them as GitHub lists them: `addIssue`, `setIssue`; the
   * comments and closes taken (`comments`, `closes`), each needing `issues: write`.
   */
  readonly issues: FakeIssues;
  private readonly appsByCode = new Map<string, FakeGitHubApp>();
  private readonly registeredApps = new Map<string, RegisteredApp>();
  private readonly signInCodes = new Map<string, SignInCode>();
  private readonly loginsByAccessToken = new Map<string, string>();
  private readonly refreshTokens = new Map<string, IssuedRefreshToken>();
  private readonly userIds = new Map<string, number>();

  private constructor(
    private readonly server: Server,
    readonly urls: GitHubUrls,
    gitUrl: string,
  ) {
    this.installations = new FakeInstallations(urls.web, gitUrl);
    this.pullRequests = new FakePullRequests(urls.web, this.installations);
    this.runs = new FakeWorkflowRuns(urls.web, this.installations);
    this.workflows = new FakeWorkflows(urls.web, this.installations, this.runs);
    this.issues = new FakeIssues(urls.web, this.installations);
  }

  /**
   * Started on `port`, or on any free one. `gitUrl` is where the repositories' clone URLs point,
   * the fake's website unless a test serves them from another host.
   */
  static async start(
    port = 0,
    { gitUrl }: { gitUrl?: string | undefined } = {},
  ): Promise<FakeGitHub> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fake = new FakeGitHub(
      server,
      { web: origin, api: `${origin}${API_PATH}` },
      gitUrl ?? origin,
    );
    server.on("request", (request, response) => void fake.handle(request, response));
    return fake;
  }

  /** An App registered with these callback URLs, as GitHub keeps it, without the manifest flow. */
  registerApp(callbackUrls: readonly string[]): FakeGitHubApp & { readonly clientSecret: string } {
    const number = this.registeredApps.size + 1;
    const app: RegisteredApp = {
      clientId: `Iv23liFake${number}`,
      clientSecret: FAKE_GITHUB_SECRETS.clientSecret,
      slug: `the-office-fake-${number}`,
      owner: "office-user",
      callbackUrls,
    };
    this.registeredApps.set(app.clientId, app);
    return app;
  }

  /** The App's owner adding a callback URL in its settings on GitHub, after the first ones. */
  addCallbackUrl(clientId: string, callbackUrl: string): void {
    const app = this.registeredApps.get(clientId);
    if (app) {
      this.registeredApps.set(clientId, {
        ...app,
        callbackUrls: [...app.callbackUrls, callbackUrl],
      });
    }
  }

  /** A code GitHub would send the browser back with, for `app`; each code converts once. */
  issueCode(app: FakeGitHubApp): string {
    const code = randomBytes(10).toString("hex");
    this.appsByCode.set(code, app);
    return code;
  }

  /** A user token for `login`, as signing in hands out, without a refresh token; it doesn't expire. */
  issueUserToken(login: string = this.signedInUser): string {
    const token = `${FAKE_TOKEN_PREFIXES[0]}${randomBytes(12).toString("hex")}`;
    this.loginsByAccessToken.set(token, login);
    this.issuedTokens.push(token);
    return token;
  }

  /** GitHub's numeric id of the user with `login`: one of its own per login, as on GitHub. */
  userIdOf(login: string): number {
    const known = this.userIds.get(login);
    if (known !== undefined) return known;
    const id = 1000 + this.userIds.size + 1;
    this.userIds.set(login, id);
    return id;
  }

  /** The requests whose path starts with `path`, under the API's base when it starts there. */
  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.path.startsWith(path));
  }

  /** GitHub deleting the App's client secret and making a new one, as its settings page does. */
  resetClientSecret(clientId: string): void {
    const app = this.registeredApps.get(clientId);
    if (app) this.registeredApps.set(clientId, { ...app, clientSecret: "reset-client-secret" });
  }

  /** GitHub ending every refresh token before its time, as revoking the App's authorization does. */
  revokeRefreshTokens(): void {
    this.refreshTokens.clear();
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.urls.web);
    const body = await readBody(request);
    const recorded: RecordedRequest = {
      method: request.method ?? "GET",
      path: url.pathname,
      search: url.search,
      accept: request.headers.accept,
      grantType: new URLSearchParams(body).get("grant_type") ?? undefined,
    };
    this.requests.push(recorded);
    const conversion = new RegExp(`^${API_PATH}/app-manifests/([^/]+)/conversions$`).exec(
      url.pathname,
    );
    const pulls = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/pulls$`).exec(url.pathname);
    const pull = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/pulls/([0-9]+)$`).exec(url.pathname);
    const pullMerge = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/pulls/([0-9]+)/merge$`).exec(
      url.pathname,
    );
    const repo = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)$`).exec(url.pathname);
    const commitChecks = new RegExp(
      `^${API_PATH}/repos/([^/]+/[^/]+)/commits/([^/]+)/(check-runs|status)$`,
    ).exec(url.pathname);
    const runs = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/actions/runs$`).exec(url.pathname);
    const rerun = new RegExp(
      `^${API_PATH}/repos/([^/]+/[^/]+)/actions/runs/([0-9]+)/(rerun|rerun-failed-jobs)$`,
    ).exec(url.pathname);
    const workflows = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/actions/workflows$`).exec(
      url.pathname,
    );
    const dispatch = new RegExp(
      `^${API_PATH}/repos/([^/]+/[^/]+)/actions/workflows/([^/]+)/dispatches$`,
    ).exec(url.pathname);
    const contents = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/contents/(.+)$`).exec(
      url.pathname,
    );
    const refs = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/(branches|tags)$`).exec(url.pathname);
    const issues = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/issues$`).exec(url.pathname);
    const issue = new RegExp(`^${API_PATH}/repos/([^/]+/[^/]+)/issues/([0-9]+)$`).exec(
      url.pathname,
    );
    const issueComments = new RegExp(
      `^${API_PATH}/repos/([^/]+/[^/]+)/issues/([0-9]+)/comments$`,
    ).exec(url.pathname);
    const appToken = new RegExp(`^${API_PATH}/applications/([^/]+)/token$`).exec(url.pathname);
    if (request.method === "POST" && url.pathname === "/settings/apps/new") {
      this.registerFromManifest(url, body, response);
    } else if (request.method === "POST" && conversion) {
      this.convert(decodeURIComponent(conversion[1] ?? ""), response);
    } else if (request.method === "GET" && url.pathname === "/login/oauth/authorize") {
      this.authorize(url.searchParams, response);
    } else if (request.method === "POST" && url.pathname === "/login/oauth/access_token") {
      // GitHub reads the parameters from the query, as its docs show them, or a form body.
      const parameters = new URLSearchParams(url.searchParams);
      for (const [key, value] of new URLSearchParams(body)) parameters.append(key, value);
      this.exchange(parameters, request.headers.accept, response);
    } else if (request.method === "DELETE" && appToken) {
      this.revoke(
        decodeURIComponent(appToken[1] ?? ""),
        request.headers.authorization,
        body,
        response,
      );
    } else if (request.method === "GET" && url.pathname === `${API_PATH}/meta`) {
      sendJson(response, 200, { ssh_keys: [GITHUB_ED25519] });
    } else if (request.method === "GET" && url.pathname === `${API_PATH}/user`) {
      this.user(request.headers.authorization, response);
    } else if (
      request.method === "GET" &&
      url.pathname.startsWith(`${API_PATH}/user/installations`)
    ) {
      this.installationsApi(url, request.headers.authorization, response);
    } else if (pulls) {
      this.pullsApi(request, url, pulls[1] ?? "", body, recorded, response);
    } else if (request.method === "GET" && pull) {
      this.readApi(request, recorded, response, () =>
        this.pullRequests.get(decodeURIComponent(pull[1] ?? ""), Number(pull[2])),
      );
    } else if (request.method === "PATCH" && pull) {
      this.writeApi(request, response, () =>
        this.pullRequests.update(decodeURIComponent(pull[1] ?? ""), Number(pull[2]), body),
      );
    } else if (request.method === "PUT" && pullMerge) {
      this.writeApi(request, response, () =>
        this.pullRequests.mergeApi(
          decodeURIComponent(pullMerge[1] ?? ""),
          Number(pullMerge[2]),
          body,
        ),
      );
    } else if (request.method === "GET" && repo) {
      this.readApi(request, recorded, response, () =>
        this.pullRequests.repository(decodeURIComponent(repo[1] ?? "")),
      );
    } else if (request.method === "GET" && commitChecks) {
      const repository = decodeURIComponent(commitChecks[1] ?? "");
      const sha = decodeURIComponent(commitChecks[2] ?? "");
      this.readApi(request, recorded, response, () =>
        commitChecks[3] === "status"
          ? this.pullRequests.combinedStatus(repository, sha)
          : this.pullRequests.checkRuns(repository, sha),
      );
    } else if (request.method === "GET" && runs) {
      const repository = decodeURIComponent(runs[1] ?? "");
      this.readApi(request, recorded, response, () => this.runs.list(repository, url));
    } else if (request.method === "POST" && rerun) {
      if (this.loginOf(request.headers.authorization) === undefined) {
        sendBadCredentials(response);
        return;
      }
      const answer = this.runs.rerun(decodeURIComponent(rerun[1] ?? ""), Number(rerun[2]));
      sendJson(response, answer.status, answer.body, answer.headers);
    } else if (request.method === "GET" && workflows) {
      const repository = decodeURIComponent(workflows[1] ?? "");
      this.readApi(request, recorded, response, () => this.workflows.list(repository, url));
    } else if (request.method === "GET" && contents) {
      const repository = decodeURIComponent(contents[1] ?? "");
      const path = decodeURIComponent(contents[2] ?? "");
      this.readApi(request, recorded, response, () =>
        this.workflows.contents(repository, path, url),
      );
    } else if (request.method === "GET" && refs) {
      const repository = decodeURIComponent(refs[1] ?? "");
      const kind = refs[2] === "tags" ? "tags" : "branches";
      this.readApi(request, recorded, response, () =>
        this.workflows.listRefs(repository, kind, url),
      );
    } else if (request.method === "POST" && dispatch) {
      if (this.loginOf(request.headers.authorization) === undefined) {
        sendBadCredentials(response);
        return;
      }
      const answer = this.workflows.dispatch(
        decodeURIComponent(dispatch[1] ?? ""),
        decodeURIComponent(dispatch[2] ?? ""),
        body,
      );
      if (answer.status === 204) response.writeHead(204).end();
      else sendJson(response, answer.status, answer.body, answer.headers);
    } else if (request.method === "GET" && issues) {
      const repository = decodeURIComponent(issues[1] ?? "");
      this.readApi(request, recorded, response, () => this.issues.list(repository, url));
    } else if (request.method === "GET" && issue) {
      const repository = decodeURIComponent(issue[1] ?? "");
      this.readApi(request, recorded, response, () =>
        this.issues.get(repository, Number(issue[2])),
      );
    } else if (request.method === "PATCH" && issue) {
      this.writeApi(request, response, () =>
        this.issues.update(decodeURIComponent(issue[1] ?? ""), Number(issue[2]), body),
      );
    } else if (request.method === "POST" && issueComments) {
      this.writeApi(request, response, () =>
        this.issues.comment(
          decodeURIComponent(issueComments[1] ?? ""),
          Number(issueComments[2]),
          body,
        ),
      );
    } else if (request.method === "POST" && url.pathname === FAKE_ISSUES_CONTROL_PATH) {
      this.control(() => this.issues.control(issueControlSchema.parse(JSON.parse(body))), response);
    } else if (request.method === "GET" && url.pathname === FAKE_ISSUES_CONTROL_PATH) {
      sendJson(response, 200, this.issues.writes());
    } else if (request.method === "POST" && url.pathname === FAKE_WORKFLOWS_CONTROL_PATH) {
      this.control(
        () => this.workflows.control(workflowControlSchema.parse(JSON.parse(body))),
        response,
      );
    } else if (request.method === "GET" && url.pathname === FAKE_WORKFLOWS_CONTROL_PATH) {
      sendJson(response, 200, this.workflows.dispatches());
    } else if (request.method === "POST" && url.pathname === FAKE_RUNS_CONTROL_PATH) {
      this.control(() => this.runs.control(runControlSchema.parse(JSON.parse(body))), response);
    } else if (request.method === "POST" && url.pathname === FAKE_INSTALLATIONS_CONTROL_PATH) {
      const { account, repositories, accountType, permissions } = installationRequestSchema.parse(
        JSON.parse(body),
      );
      this.installations.install(account, repositories, {
        ...(accountType && { accountType }),
        ...(permissions && { permissions }),
      });
      response.writeHead(204).end();
    } else if (request.method === "POST" && url.pathname === FAKE_PULL_REQUESTS_CONTROL_PATH) {
      this.control(
        () => this.pullRequests.control(pullRequestControlSchema.parse(JSON.parse(body))),
        response,
      );
    } else if (request.method === "POST" && url.pathname === FAKE_PERMISSIONS_CONTROL_PATH) {
      const { account, permissions } = grantRequestSchema.parse(JSON.parse(body));
      this.control(() => this.installations.grant(account, permissions), response);
    } else {
      sendJson(response, 404, { message: "Not Found" });
    }
  }

  /** What the browser sees after posting the form: GitHub registered the App and sends it back. */
  private registerFromManifest(url: URL, body: string, response: ServerResponse): void {
    const manifest: unknown = JSON.parse(new URLSearchParams(body).get("manifest") ?? "null");
    this.postedManifests.push(manifest);
    const { redirect_url: redirectUrl, callback_urls: callbackUrls } = (manifest ?? {}) as {
      redirect_url?: unknown;
      callback_urls?: unknown;
    };
    if (typeof redirectUrl !== "string") {
      sendJson(response, 422, { message: "The manifest has no redirect_url." });
      return;
    }
    const app = this.registerApp(Array.isArray(callbackUrls) ? callbackUrls.map(String) : []);
    const back = new URL(redirectUrl);
    back.searchParams.set("code", this.issueCode(app));
    const state = url.searchParams.get("state");
    if (state !== null) back.searchParams.set("state", state);
    response.writeHead(302, { location: back.href }).end();
  }

  private convert(code: string, response: ServerResponse): void {
    const app = this.appsByCode.get(code);
    if (app === undefined) {
      sendJson(response, 404, { message: "Not Found" });
      return;
    }
    this.appsByCode.delete(code);
    sendJson(response, 201, {
      id: 1000 + this.registeredApps.size,
      slug: app.slug,
      node_id: "A_fake",
      client_id: app.clientId,
      owner: { login: app.owner, id: 1, type: "User" },
      name: app.slug,
      html_url: `${this.urls.web}/apps/${app.slug}`,
      client_secret: FAKE_GITHUB_SECRETS.clientSecret,
      webhook_secret: FAKE_GITHUB_SECRETS.webhookSecret,
      pem: FAKE_GITHUB_SECRETS.pem,
    });
  }

  /**
   * The authorize page once the user has decided. A `redirect_uri` that isn't one of the App's
   * callback URLs sends the browser to the first one with `redirect_uri_mismatch`, and a cancel
   * with `access_denied`, as GitHub's OAuth troubleshooting page describes.
   */
  private authorize(query: URLSearchParams, response: ServerResponse): void {
    const app = this.registeredApps.get(query.get("client_id") ?? "");
    const firstCallback = app?.callbackUrls[0];
    if (app === undefined || firstCallback === undefined) {
      sendJson(response, 404, { message: "Not Found" });
      return;
    }
    this.authorizeScopes.push(query.get("scope"));
    const redirectUri = query.get("redirect_uri") ?? firstCallback;
    const state = query.get("state");
    const challengeMethod = query.get("code_challenge_method");
    if (!app.callbackUrls.includes(redirectUri)) {
      redirectBack(response, firstCallback, state, oauthError("redirect_uri_mismatch"));
    } else if (challengeMethod !== null && challengeMethod !== "S256") {
      // Undocumented which error GitHub gives for `plain`; its docs say only S256 is supported.
      redirectBack(response, redirectUri, state, oauthError("invalid_request"));
    } else if (this.cancelAuthorization) {
      redirectBack(response, redirectUri, state, oauthError("access_denied"));
    } else {
      const code = randomBytes(10).toString("hex");
      this.signInCodes.set(code, {
        clientId: app.clientId,
        redirectUri,
        codeChallenge: query.get("code_challenge") ?? undefined,
        login: this.signedInUser,
        expiresAt: Date.now() + SIGN_IN_CODE_MS,
      });
      redirectBack(response, redirectUri, state, { code });
    }
  }

  /**
   * The token endpoint exchanging a sign-in's code. GitHub answers its refusals with HTTP 200 and
   * an `error`, and answers form-encoded unless asked for JSON.
   */
  private exchange(
    parameters: URLSearchParams,
    accept: string | undefined,
    response: ServerResponse,
  ): void {
    if (this.tokenEndpointDown) {
      response.writeHead(503, { "content-type": "text/html" }).end("<h1>Unicorn!</h1>");
      return;
    }
    const answer = this.exchangeAnswer(parameters);
    if (accept?.includes("application/json")) {
      sendJson(response, 200, answer);
      return;
    }
    const form = new URLSearchParams(
      Object.entries(answer).map(([key, value]): [string, string] => [key, String(value)]),
    );
    response
      .writeHead(200, { "content-type": "application/x-www-form-urlencoded; charset=utf-8" })
      .end(form.toString());
  }

  private exchangeAnswer(parameters: URLSearchParams): Record<string, string | number> {
    const app = this.registeredApps.get(parameters.get("client_id") ?? "");
    if (app === undefined || parameters.get("client_secret") !== app.clientSecret) {
      return oauthError("incorrect_client_credentials");
    }
    if (parameters.get("grant_type") === "refresh_token") {
      return this.refreshAnswer(parameters.get("refresh_token") ?? "");
    }
    const codeValue = parameters.get("code") ?? "";
    const code = this.signInCodes.get(codeValue);
    // A code is used once, whatever came of it.
    this.signInCodes.delete(codeValue);
    if (code === undefined || code.clientId !== app.clientId || code.expiresAt <= Date.now()) {
      return oauthError("bad_verification_code");
    }
    const redirectUri = parameters.get("redirect_uri");
    if (redirectUri !== null && redirectUri !== code.redirectUri) {
      return oauthError("redirect_uri_mismatch");
    }
    const verifier = parameters.get("code_verifier");
    const challenge =
      verifier === null ? undefined : createHash("sha256").update(verifier).digest("base64url");
    if (code.codeChallenge !== challenge) {
      // Undocumented which error GitHub gives for a wrong or missing verifier.
      return oauthError("bad_verification_code");
    }
    return this.tokensFor(code.login);
  }

  /**
   * A refresh: a new user token and refresh token, and the ones before no longer work. Undocumented
   * which `error` GitHub gives a used, revoked or unknown refresh token; `bad_refresh_token` is what
   * it is known to answer.
   */
  private refreshAnswer(refreshToken: string): Record<string, string | number> {
    const issued = this.refreshTokens.get(refreshToken);
    if (issued === undefined) return oauthError("bad_refresh_token");
    this.refreshTokens.delete(refreshToken);
    this.loginsByAccessToken.delete(issued.accessToken);
    return this.tokensFor(issued.login);
  }

  /** Expiring tokens, as an App whose user tokens expire, or asked for `offline_access`, gets. */
  private tokensFor(login: string): Record<string, string | number> {
    const accessToken = `${FAKE_TOKEN_PREFIXES[0]}${randomBytes(12).toString("hex")}`;
    const refreshToken = `${FAKE_TOKEN_PREFIXES[1]}${randomBytes(12).toString("hex")}`;
    this.issuedTokens.push(accessToken, refreshToken);
    this.loginsByAccessToken.set(accessToken, login);
    this.refreshTokens.set(refreshToken, { login, accessToken });
    return {
      access_token: accessToken,
      expires_in: 28800,
      refresh_token: refreshToken,
      refresh_token_expires_in: 15897600,
      scope: "",
      token_type: "bearer",
    };
  }

  private user(authorization: string | undefined, response: ServerResponse): void {
    const login = this.loginOf(authorization);
    if (login === undefined) {
      sendBadCredentials(response);
      return;
    }
    sendJson(response, 200, { login, id: this.userIdOf(login), type: "User" });
  }

  /**
   * Revokes one user token of the App, with its client ID and secret by Basic auth: 204, or 404
   * for a token GitHub doesn't know (docs.github.com/rest/apps/oauth-applications#delete-an-app-token).
   */
  private revoke(
    clientId: string,
    authorization: string | undefined,
    body: string,
    response: ServerResponse,
  ): void {
    const app = this.registeredApps.get(clientId);
    const credentials = Buffer.from(
      authorization?.replace(/^Basic /, "") ?? "",
      "base64",
    ).toString();
    if (app === undefined || credentials !== `${app.clientId}:${app.clientSecret}`) {
      sendJson(response, 404, { message: "Not Found" });
      return;
    }
    const { access_token: accessToken } = z
      .object({ access_token: z.string() })
      .catch({ access_token: "" })
      .parse(JSON.parse(body || "null"));
    if (!this.loginsByAccessToken.delete(accessToken)) {
      sendJson(response, 404, { message: "Not Found" });
      return;
    }
    this.revokedTokens.push(accessToken);
    response.writeHead(204).end();
  }

  private installationsApi(
    url: URL,
    authorization: string | undefined,
    response: ServerResponse,
  ): void {
    if (this.loginOf(authorization) === undefined) {
      sendBadCredentials(response);
      return;
    }
    const repositories = new RegExp(`^${API_PATH}/user/installations/([0-9]+)/repositories$`).exec(
      url.pathname,
    );
    let answer: ApiAnswer;
    if (url.pathname === `${API_PATH}/user/installations`) {
      answer = this.installations.listInstallations(url);
    } else if (repositories) {
      answer = this.installations.listRepositories(url, Number(repositories[1]));
    } else {
      answer = { status: 404, body: { message: "Not Found" } };
    }
    sendJson(response, answer.status, answer.body, answer.headers);
  }

  private pullsApi(
    request: IncomingMessage,
    url: URL,
    repository: string,
    body: string,
    recorded: RecordedRequest,
    response: ServerResponse,
  ): void {
    const fullName = decodeURIComponent(repository);
    if (request.method === "GET") {
      this.readApi(request, recorded, response, () => this.pullRequests.list(fullName, url));
      return;
    }
    if (this.loginOf(request.headers.authorization) === undefined) {
      sendBadCredentials(response);
      return;
    }
    const answer: ApiAnswer =
      request.method === "POST"
        ? this.pullRequests.open(fullName, body)
        : { status: 404, body: { message: "Not Found" } };
    sendJson(response, answer.status, answer.body, answer.headers);
  }

  /**
   * A read of the REST API that answers with an ETag, the hash of what it answers, and with 304 Not
   * Modified, no body, when the request's `If-None-Match` names it, as GitHub's conditional
   * requests do.
   */
  private readApi(
    request: IncomingMessage,
    recorded: RecordedRequest,
    response: ServerResponse,
    read: () => ApiAnswer,
  ): void {
    if (this.loginOf(request.headers.authorization) === undefined) {
      sendBadCredentials(response);
      return;
    }
    const answer = read();
    if (answer.status !== 200) {
      sendJson(response, answer.status, answer.body, answer.headers);
      return;
    }
    const etag = `W/"${createHash("sha1").update(JSON.stringify(answer.body)).digest("hex")}"`;
    if (request.headers["if-none-match"] === etag) {
      this.notModified.push(recorded);
      response.writeHead(304, { ...answer.headers, etag }).end();
      return;
    }
    sendJson(response, answer.status, answer.body, { ...answer.headers, etag });
  }

  /** A change through the REST API as the token's user. */
  private writeApi(
    request: IncomingMessage,
    response: ServerResponse,
    write: () => ApiAnswer,
  ): void {
    if (this.loginOf(request.headers.authorization) === undefined) {
      sendBadCredentials(response);
      return;
    }
    const answer = write();
    sendJson(response, answer.status, answer.body, answer.headers);
  }

  /** Runs a control of the fake: 204, or 404 when it names what the fake doesn't have. */
  private control(apply: () => void, response: ServerResponse): void {
    try {
      apply();
      response.writeHead(204).end();
    } catch (error) {
      sendJson(response, 404, { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private loginOf(authorization: string | undefined): string | undefined {
    return this.loginsByAccessToken.get(authorization?.replace(/^Bearer /, "") ?? "");
  }
}

function oauthError(error: string): Record<string, string> {
  return {
    error,
    error_description: `Fake GitHub: ${error}.`,
    error_uri: `https://docs.github.com/apps/troubleshooting#${error}`,
  };
}

function redirectBack(
  response: ServerResponse,
  callbackUrl: string,
  state: string | null,
  parameters: Record<string, string>,
): void {
  const back = new URL(callbackUrl);
  for (const [key, value] of Object.entries(parameters)) back.searchParams.set(key, value);
  if (state !== null) back.searchParams.set("state", state);
  response.writeHead(302, { location: back.href }).end();
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendBadCredentials(response: ServerResponse): void {
  sendJson(response, 401, { message: "Bad credentials", status: "401" });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response
    .writeHead(status, { ...headers, "content-type": "application/json" })
    .end(JSON.stringify(body));
}
