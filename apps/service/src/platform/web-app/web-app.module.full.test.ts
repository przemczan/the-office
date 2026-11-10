import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication, type TestApplication } from "../../../test/test-application.js";
import { HealthModule } from "../health/health.module.js";
import { WebAppModule } from "./web-app.module.js";

const INDEX_HTML = "<!doctype html><title>The Office</title>";
const SCRIPT = "console.log('The Office');";

let webAppDirectory: string;
let service: TestApplication;

beforeAll(async () => {
  webAppDirectory = await mkdtemp(path.join(tmpdir(), "office-web-app-"));
  await mkdir(path.join(webAppDirectory, "dist", "assets"), { recursive: true });
  await writeFile(path.join(webAppDirectory, "dist", "index.html"), INDEX_HTML);
  await writeFile(path.join(webAppDirectory, "dist", "assets", "index.js"), SCRIPT);
  service = await startTestApplication({
    database: true,
    imports: [HealthModule, WebAppModule.register({ directory: webAppDirectory, source: "built" })],
  });
});

afterAll(async () => {
  await service?.app.close();
  await rm(webAppDirectory, { recursive: true, force: true });
});

interface Reply {
  readonly status: number;
  readonly contentType: string | undefined;
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
  it("opens any of its own addresses, for the router to show", async () => {
    const reply = await get("/settings");

    expect(reply.status).toBe(200);
    expect(reply.body).toBe(INDEX_HTML);
  });

  it("serves its assets", async () => {
    const reply = await get("/assets/index.js");

    expect(reply.status).toBe(200);
    expect(reply.contentType).toMatch(/javascript/);
    expect(reply.body).toBe(SCRIPT);
  });

  it("answers a missing asset with 404, not with the app", async () => {
    const reply = await get("/assets/gone.js");

    expect(reply.status).toBe(404);
  });

  it("leaves /api to the API", async () => {
    const health = await get("/api/health");
    const unknown = await get("/api/nope");

    expect(health).toMatchObject({ status: 200, body: JSON.stringify({ database: "up" }) });
    expect(unknown.status).toBe(404);
    expect(unknown.contentType).toMatch(/^application\/json/);
  });
});
