import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { GitHubUrls } from "../../application/github-urls.js";

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
}

/** The REST API's base path on the fake, so a client that drops its base's path is caught. */
const API_PATH = "/api/v3";

/** GitHub's own limit on a sign-in's code. */
const SIGN_IN_CODE_MS = 10 * 60 * 1000;

/** An App registered from a manifest, as GitHub keeps it. */
interface RegisteredApp extends FakeGitHubApp {
  readonly clientSecret: string;
  readonly callbackUrls: readonly string[];
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
 * App's web sign-in, and `GET /user`. One server is both bases of `urls`. Behaves as
 * docs.github.com describes; where the docs are silent, as noted at each place.
 */
export class FakeGitHub {
  /** Every request, in order. */
  readonly requests: RecordedRequest[] = [];
  /** The manifests posted to the new-App page, parsed, in order. */
  readonly postedManifests: unknown[] = [];
  /** Every token handed out, so tests can check none reaches the web. */
  readonly issuedTokens: string[] = [];
  /** Who authorizes on GitHub's authorize page; GitHub's own page would ask them. */
  signedInUser = "office-user";
  /** Whether the user cancels on the authorize page instead of authorizing. */
  cancelAuthorization = false;
  private readonly appsByCode = new Map<string, FakeGitHubApp>();
  private readonly registeredApps = new Map<string, RegisteredApp>();
  private readonly signInCodes = new Map<string, SignInCode>();
  private readonly loginsByAccessToken = new Map<string, string>();

  private constructor(
    private readonly server: Server,
    readonly urls: GitHubUrls,
  ) {}

  static async start(): Promise<FakeGitHub> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fake = new FakeGitHub(server, { web: origin, api: `${origin}${API_PATH}` });
    server.on("request", (request, response) => void fake.handle(request, response));
    return fake;
  }

  /** A code GitHub would send the browser back with, for `app`; each code converts once. */
  issueCode(app: FakeGitHubApp): string {
    const code = randomBytes(10).toString("hex");
    this.appsByCode.set(code, app);
    return code;
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

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.urls.web);
    this.requests.push({
      method: request.method ?? "GET",
      path: url.pathname,
      search: url.search,
      accept: request.headers.accept,
    });
    const body = await readBody(request);
    const conversion = new RegExp(`^${API_PATH}/app-manifests/([^/]+)/conversions$`).exec(
      url.pathname,
    );
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
    } else if (request.method === "GET" && url.pathname === `${API_PATH}/user`) {
      this.user(request.headers.authorization, response);
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
    const number = this.registeredApps.size + 1;
    const app: RegisteredApp = {
      clientId: `Iv23liFake${number}`,
      clientSecret: FAKE_GITHUB_SECRETS.clientSecret,
      slug: `the-office-fake-${number}`,
      owner: "office-user",
      callbackUrls: Array.isArray(callbackUrls) ? callbackUrls.map(String) : [],
    };
    this.registeredApps.set(app.clientId, app);
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

  /** Expiring tokens, as an App whose user tokens expire, or asked for `offline_access`, gets. */
  private tokensFor(login: string): Record<string, string | number> {
    const accessToken = `${FAKE_TOKEN_PREFIXES[0]}${randomBytes(12).toString("hex")}`;
    const refreshToken = `${FAKE_TOKEN_PREFIXES[1]}${randomBytes(12).toString("hex")}`;
    this.issuedTokens.push(accessToken, refreshToken);
    this.loginsByAccessToken.set(accessToken, login);
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
    const login = this.loginsByAccessToken.get(authorization?.replace(/^Bearer /, "") ?? "");
    if (login === undefined) {
      sendJson(response, 401, { message: "Bad credentials", status: "401" });
      return;
    }
    sendJson(response, 200, { login, id: 1, type: "User" });
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

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
