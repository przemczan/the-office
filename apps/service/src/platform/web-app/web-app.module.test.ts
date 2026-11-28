import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication, type TestApplication } from "../../../test/test-application.js";
import { HealthModule } from "../health/health.module.js";
import { WebAppBuild, webAppBuildOf } from "./web-app-build.js";
import { WebAppModule } from "./web-app.module.js";

const APPEARANCE_SCRIPT = "document.documentElement.dataset.palette = 'dark';";
const INDEX_HTML = `<!doctype html><title>The Office</title><script>${APPEARANCE_SCRIPT}</script><script type="module" src="/assets/index.js"></script>`;
const SCRIPT = "console.log('The Office');";

let webAppDirectory: string;
let service: TestApplication;

beforeAll(async () => {
  // Under a dot folder, as an install in ~/.local is: the web app is served all the same.
  webAppDirectory = await mkdtemp(path.join(tmpdir(), ".office-web-app-"));
  await mkdir(path.join(webAppDirectory, "dist", "assets"), { recursive: true });
  await writeFile(path.join(webAppDirectory, "dist", "index.html"), INDEX_HTML);
  await writeFile(path.join(webAppDirectory, "dist", "assets", "index.js"), SCRIPT);
  service = await startTestApplication({
    database: true,
    imports: [
      HealthModule,
      WebAppModule.register({
        directory: webAppDirectory,
        source: "built",
        formTargets: ["https://github.com"],
      }),
    ],
  });
});

afterAll(async () => {
  await service?.app.close();
  await rm(webAppDirectory, { recursive: true, force: true });
});

interface Reply {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly contentSecurityPolicy: string | undefined;
  readonly body: string;
}

// node:http, since fetch does not let a test choose the Host header.
function get(requestPath: string, headers: OutgoingHttpHeaders = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: service.port,
        path: requestPath,
        headers: { host: `localhost:${service.port}`, ...headers },
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (body += chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            contentType: incoming.headers["content-type"],
            contentSecurityPolicy: incoming.headers["content-security-policy"]?.toString(),
            body,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("the built web app", () => {
  it("is served at the root", async () => {
    const reply = await get("/");

    expect(reply.status).toBe(200);
    expect(reply.contentType).toMatch(/^text\/html/);
    expect(reply.body).toBe(INDEX_HTML);
  });

  it("runs only its own scripts and the inline one it was built with, loads no other site's and posts forms only to itself and GitHub", async () => {
    const pages = await Promise.all([get("/"), get("/settings"), get("/index.html")]);
    const hash = createHash("sha256").update(APPEARANCE_SCRIPT).digest("base64");

    for (const { contentSecurityPolicy } of pages) {
      expect(contentSecurityPolicy?.split("; ")).toEqual([
        "default-src 'self'",
        `script-src 'self' 'sha256-${hash}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ws://localhost:${service.port} wss://localhost:${service.port} data: blob:`,
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self' https://github.com",
        "frame-ancestors 'none'",
      ]);
    }
  });

  it("refuses a page addressed to another host, as the API does", async () => {
    const reply = await get("/", { host: `office.example:${service.port}` });

    expect(reply.status).toBe(403);
  });

  it("names its build by its index.html, which names the build's assets", () => {
    expect(service.app.get(WebAppBuild)).toEqual(webAppBuildOf(INDEX_HTML));
    expect(webAppBuildOf(INDEX_HTML).id).toMatch(/^[0-9a-f]{16}$/);
    expect(webAppBuildOf(INDEX_HTML.replace("index.js", "index-2.js"))).not.toEqual(
      webAppBuildOf(INDEX_HTML),
    );
  });
});
