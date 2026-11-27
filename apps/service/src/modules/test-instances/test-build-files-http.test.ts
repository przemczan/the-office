import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { testBuildFileLinkSchema, type TestBuildFileLink } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import type { Unsubscribe } from "../../platform/events/event-bus.js";
import { RequestAccessModule } from "../../platform/http/request-access.module.js";
import { SIGNED_IN_FOR_TESTS } from "../../platform/http/signed-in-requests.fixtures.js";
import { SignedInRequests, type SignedIn } from "../../platform/http/signed-in-requests.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { TestInstanceOfficeActionsController } from "./adapters/http/test-instance-office-actions.controller.js";
import { TestBuildFilesController } from "./adapters/http/test-build-files.controller.js";
import { TEST_BUILD_LINK_MS } from "./domain/test-build.js";
import { filesRemoved, type TestInstance } from "./domain/test-instance.js";
import {
  officeActionProviders,
  testInstancesTestbed,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

const PUBLIC_ADDRESS = "https://office.example.com";
const PUBLIC_HOST = "office.example.com";
const SIGNED_IN_HEADER = "x-test-signed-in";

/** Signs in only a request carrying the test's header, so a request without it is signed out. */
@Injectable()
class SignedInByHeader extends SignedInRequests {
  signedInOf(request: IncomingMessage): Promise<SignedIn | undefined> {
    return Promise.resolve(
      request.headers[SIGNED_IN_HEADER] === "yes" ? SIGNED_IN_FOR_TESTS : undefined,
    );
  }

  onSignedOut(): Unsubscribe {
    return () => undefined;
  }

  signedOutAmong(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

@Module({ providers: [SignedInByHeader], exports: [SignedInByHeader] })
class SignedInByHeaderModule {}

let app: INestApplication;
let port: number;
let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  environments = await runEnvironmentsTestbed(runtime);
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  // The build runs on the workstation and makes an APK and its mapping.
  testbed.project.runEnvironmentOn = false;
  testbed.projects.onBuild = async ({ checkout }) => {
    for (const [path, text] of Object.entries({
      "app/build/outputs/apk/debug/app.apk": "apk bytes",
      "app/build/outputs/apk/debug/mapping.apk": "mapping bytes",
    })) {
      await mkdir(dirname(join(checkout, path)), { recursive: true });
      await writeFile(join(checkout, path), text);
    }
    return { exitCode: 0, endedBy: undefined };
  };
  ({ app, port } = await startTestApplication({
    imports: [
      RequestAccessModule.register({
        publicAddress: PUBLIC_ADDRESS,
        imports: [SignedInByHeaderModule],
        signedInRequests: SignedInByHeader,
      }),
    ],
    controllers: [TestBuildFilesController, TestInstanceOfficeActionsController],
    providers: officeActionProviders(testbed, { publicAddress: PUBLIC_ADDRESS }),
    requestAccess: "guarded",
  }));
});

afterEach(async () => {
  await testbed.instances.settled();
  await app.close();
  await rm(environments.folder, { recursive: true, force: true });
});

interface Answer {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

/** A request with the Host given, signed in unless asked not to be. */
function send(
  method: "GET" | "POST",
  path: string,
  { signedIn = true, host = `127.0.0.1:${port}` }: { signedIn?: boolean; host?: string } = {},
): Promise<Answer> {
  const headers: OutgoingHttpHeaders = { host, ...(signedIn ? { [SIGNED_IN_HEADER]: "yes" } : {}) };
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      { host: "127.0.0.1", port, method, path: `/api${path}`, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}

async function linkAtThePublicAddress(
  instance: TestInstance,
  name: string,
): Promise<Extract<TestBuildFileLink, { kind: "link" }>> {
  const answer = await send("POST", `/test-instances/${instance.id}/files/${name}/link`, {
    host: PUBLIC_HOST,
  });
  expect(answer.status).toBe(200);
  const link = testBuildFileLinkSchema.parse(JSON.parse(answer.body));
  if (link.kind !== "link") throw new Error("No link.");
  return link;
}

function openLink(url: string): Promise<Answer> {
  return send("GET", new URL(url).pathname.replace(/^\/api/, ""), {
    signedIn: false,
    host: PUBLIC_HOST,
  });
}

/** The token's payload changed as given, its signature kept. */
function tampered(url: string, payload: (lines: string[]) => string[]): string {
  const token = url.slice(url.lastIndexOf("/") + 1);
  const [encoded = "", mac = ""] = token.split(".");
  const lines = Buffer.from(encoded, "base64url").toString("utf8").split("\n");
  const changed = Buffer.from(payload(lines).join("\n"), "utf8").toString("base64url");
  return `${url.slice(0, url.lastIndexOf("/") + 1)}${changed}.${mac}`;
}

describe("a Built instance's files", () => {
  it("downloads one behind sign-in, as an APK attachment the browser doesn't sniff", async () => {
    const instance = await testbed.buildAndSettle();
    expect(instance).toMatchObject({
      state: "built",
      files: [
        expect.objectContaining({ name: "app.apk" }),
        expect.objectContaining({ name: "mapping.apk" }),
      ],
    });

    const answer = await send("GET", `/test-instances/${instance.id}/files/app.apk`);

    expect(answer.status).toBe(200);
    expect(answer.body).toBe("apk bytes");
    expect(answer.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["content-disposition"]).toBe(
      `attachment; filename="app.apk"; filename*=UTF-8''app.apk`,
    );
  });

  it("answers 401 signed out, and 404 for a name it doesn't list, another instance or files removed", async () => {
    const instance = await testbed.buildAndSettle();
    const files = `/test-instances/${instance.id}/files`;

    expect((await send("GET", `${files}/app.apk`, { signedIn: false })).status).toBe(401);
    expect((await send("GET", `${files}/other.apk`)).status).toBe(404);
    expect((await send("GET", `${files}/..%2F..%2Fapp.apk`)).status).toBe(404);
    expect((await send("GET", `/test-instances/${randomUUID()}/files/app.apk`)).status).toBe(404);
    expect((await send("POST", `${files}/other.apk/link`)).status).toBe(404);

    await testbed.repository.update(instance.id, (kept) => filesRemoved(kept, new Date()));
    expect((await send("GET", `${files}/app.apk`)).status).toBe(404);
  });
});

describe("a file's link for a phone", () => {
  it("says to open The Office by its LAN address when the page is at localhost", async () => {
    const instance = await testbed.buildAndSettle();
    const path = `/test-instances/${instance.id}/files/app.apk/link`;

    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
      const answer = await send("POST", path, { host });
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({ kind: "needs-lan-address" });
    }
  });

  it("downloads its one file without sign-in at the address the page was opened at, for an hour", async () => {
    const instance = await testbed.buildAndSettle();

    const link = await linkAtThePublicAddress(instance, "app.apk");

    expect(link.url.startsWith(`${PUBLIC_ADDRESS}/api/sign-in/test-builds/`)).toBe(true);
    expect(link.expiresAt).toBe(
      new Date(testbed.schedule.now().getTime() + TEST_BUILD_LINK_MS).toISOString(),
    );
    const opened = await openLink(link.url);
    expect(opened.status).toBe(200);
    expect(opened.body).toBe("apk bytes");
    expect(opened.headers["content-disposition"]).toContain("attachment");

    await testbed.schedule.advanceBy(TEST_BUILD_LINK_MS - 1);
    expect((await openLink(link.url)).status).toBe(200);
    await testbed.schedule.advanceBy(1);
    expect((await openLink(link.url)).status).toBe(404);
  });

  it("is refused for another file, another instance or a token tampered with", async () => {
    const instance = await testbed.buildAndSettle();
    const other = await testbed.buildAndSettle();
    const link = await linkAtThePublicAddress(instance, "app.apk");

    const anotherFile = tampered(link.url, ([id = "", expiry = ""]) => [id, expiry, "mapping.apk"]);
    const anotherInstance = tampered(link.url, ([, expiry = "", name = ""]) => [
      other.id,
      expiry,
      name,
    ]);
    const later = tampered(link.url, ([id = "", expiry = "", name = ""]) => [
      id,
      String(Number(expiry) + TEST_BUILD_LINK_MS),
      name,
    ]);
    const badMac = `${link.url.slice(0, -2)}${link.url.endsWith("AA") ? "BB" : "AA"}`;

    for (const url of [anotherFile, anotherInstance, later, badMac]) {
      const answer = await openLink(url);
      expect(answer.status).toBe(404);
      expect(answer.body).not.toContain("apk bytes");
    }
    expect((await openLink(`${PUBLIC_ADDRESS}/api/sign-in/test-builds/nonsense`)).status).toBe(404);
  });
});
