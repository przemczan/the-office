import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { GitHubUrls } from "../../application/github-urls.js";

/** The secrets the fake hands out with each App, which tests check The Office never keeps or shows. */
export const FAKE_GITHUB_SECRETS = {
  pem: "-----BEGIN RSA PRIVATE KEY-----\nfake-private-key\n-----END RSA PRIVATE KEY-----\n",
  clientSecret: "fake-client-secret-0123456789abcdef",
  webhookSecret: "fake-webhook-secret-0123456789",
} as const;

export interface FakeGitHubApp {
  readonly clientId: string;
  readonly slug: string;
  readonly owner: string;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly accept: string | undefined;
}

/** The REST API's base path on the fake, so a client that drops its base's path is caught. */
const API_PATH = "/api/v3";

/**
 * GitHub on 127.0.0.1, as far as The Office uses it: the page that registers an App from a
 * manifest, and the REST API converting its code. One server is both bases of `urls`.
 */
export class FakeGitHub {
  /** Every request, in order. */
  readonly requests: RecordedRequest[] = [];
  /** The manifests posted to the new-App page, parsed, in order. */
  readonly postedManifests: unknown[] = [];
  private readonly appsByCode = new Map<string, FakeGitHubApp>();
  private registeredApps = 0;

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
    } else {
      sendJson(response, 404, { message: "Not Found" });
    }
  }

  /** What the browser sees after posting the form: GitHub registered the App and sends it back. */
  private registerFromManifest(url: URL, body: string, response: ServerResponse): void {
    const manifest: unknown = JSON.parse(new URLSearchParams(body).get("manifest") ?? "null");
    this.postedManifests.push(manifest);
    const redirectUrl = (manifest as { redirect_url?: unknown } | null)?.redirect_url;
    if (typeof redirectUrl !== "string") {
      sendJson(response, 422, { message: "The manifest has no redirect_url." });
      return;
    }
    this.registeredApps += 1;
    const back = new URL(redirectUrl);
    back.searchParams.set(
      "code",
      this.issueCode({
        clientId: `Iv23liFake${this.registeredApps}`,
        slug: `the-office-fake-${this.registeredApps}`,
        owner: "office-user",
      }),
    );
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
      id: 1000 + this.registeredApps,
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
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
