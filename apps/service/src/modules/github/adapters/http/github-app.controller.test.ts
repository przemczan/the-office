import { request as httpRequest } from "node:http";
import type { INestApplication } from "@nestjs/common";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  gitHubAppManifestFormSchema,
  gitHubWebEventSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubAppManifestForm,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../../engine/index.js";
import { GitHubModule } from "../../github.module.js";
import { FAKE_GITHUB_SECRETS, FakeGitHub } from "../../index.fixtures.js";
import { GitHubAppRepository } from "../../ports/github-app-repository.js";
import { GitHubAppForTests } from "../../ports/github-app-repository.fixtures.js";
import { GitHubSignInRepository } from "../../ports/github-sign-in-repository.js";
import { GitHubSignInForTests } from "../../ports/github-sign-in-repository.fixtures.js";

let github: FakeGitHub;
let app: INestApplication;
let url: string;
let apps: GitHubAppForTests;
let published: DomainEvent[];

const PUBLIC_ADDRESS = "https://office.example.com";

beforeEach(async () => {
  github = await FakeGitHub.start();
  await startOffice(undefined);
});

async function startOffice(publicAddress: string | undefined): Promise<void> {
  apps = new GitHubAppForTests();
  ({ app, url } = await startTestApplication({
    database: true,
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    imports: [EventsModule, EventStreamModule, TelemetryModule, GitHubModule.register(github.urls)],
    overrides: [
      { provide: GitHubAppRepository, useValue: apps },
      { provide: GitHubSignInRepository, useValue: new GitHubSignInForTests() },
      { provide: OfficeAddresses, useValue: new OfficeAddresses(publicAddress) },
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
}

/** The manifest's callback URLs, the form asked for at `host`, as a browser there would. */
function callbackUrlsAt(host: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { port } = new URL(url);
    const outgoing = httpRequest(
      { host: "127.0.0.1", port, path: "/api/github/app/manifest", headers: { host } },
      (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (text += chunk));
        incoming.on("end", () => {
          const form = gitHubAppManifestFormSchema.parse(JSON.parse(text));
          resolve((JSON.parse(form.manifest) as { callback_urls: unknown }).callback_urls);
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

afterEach(async () => {
  await app.close();
  await github.close();
});

async function manifestForm(): Promise<GitHubAppManifestForm> {
  const response = await fetch(`${url}/api/github/app/manifest`);
  expect(response.status).toBe(200);
  return gitHubAppManifestFormSchema.parse(await response.json());
}

/** Posts the form as the browser does; returns where GitHub sends the browser back. */
async function postToGitHub({ action, manifest }: GitHubAppManifestForm): Promise<string> {
  const response = await fetch(action, {
    method: "POST",
    body: new URLSearchParams({ manifest }),
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  return response.headers.get("location") ?? "";
}

/** Follows GitHub's redirect back to The Office; returns where The Office sends the browser. */
async function returnToOffice(location: string): Promise<URL> {
  const response = await fetch(location, { redirect: "manual" });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "", url);
}

function failureOf(landing: URL): string | null {
  expect(landing.pathname).toBe(OFFICE_IDENTITY_SETTINGS_PATH);
  return landing.searchParams.get(GITHUB_APP_REGISTRATION_FAILED_PARAMETER);
}

function conversions(): number {
  return github.requestsTo(`${new URL(github.urls.api).pathname}/app-manifests/`).length;
}

describe("/api/github/app", () => {
  it("converts the code GitHub sends back with, keeping the Client ID, client secret, slug and owner and no other secret", async () => {
    const landing = await returnToOffice(await postToGitHub(await manifestForm()));

    expect(failureOf(landing)).toBeNull();
    expect(apps.app).toEqual({
      clientId: "Iv23liFake1",
      clientSecret: FAKE_GITHUB_SECRETS.clientSecret,
      slug: "the-office-fake-1",
      owner: "office-user",
    });
    const forwarding = app.get(WebEventForwarding);
    expect(
      published.map((event) => {
        const { occurredAt: _occurredAt, ...webEvent } = gitHubWebEventSchema.parse(
          forwarding.toWebEvent(event),
        );
        return webEvent;
      }),
    ).toEqual([{ type: "github.changed" }]);
    const kept = JSON.stringify(apps.app);
    expect(kept).not.toContain(JSON.stringify(FAKE_GITHUB_SECRETS.pem).slice(1, -1));
    expect(kept).not.toContain(FAKE_GITHUB_SECRETS.webhookSecret);
    const shown = JSON.stringify([published, landing.href]);
    for (const secret of Object.values(FAKE_GITHUB_SECRETS)) expect(shown).not.toContain(secret);
    expect(github.requestsTo(new URL(github.urls.api).pathname)).toEqual([
      expect.objectContaining({ method: "POST", accept: "application/vnd.github+json" }),
    ]);
  });

  it("refuses a code that came back without a state this Office handed out, never asking GitHub", async () => {
    const code = github.issueCode({ clientId: "Iv23liOther", slug: "other", owner: "someone" });

    const unknown = await returnToOffice(
      `${url}/api/github/app/registered?code=${code}&state=not-from-this-office`,
    );
    const missing = await returnToOffice(`${url}/api/github/app/registered?code=${code}`);

    expect(failureOf(unknown)).toContain("wasn't started from this Office");
    expect(failureOf(missing)).toContain("wasn't started from this Office");
    expect(conversions()).toBe(0);
    expect(apps.app).toBeUndefined();
    expect(published).toEqual([]);
  });

  it("lists Sign in with GitHub's callback first, then Continue with GitHub's here and at the public address", async () => {
    await app.close();
    await startOffice(PUBLIC_ADDRESS);
    const { port } = new URL(url);

    expect(await callbackUrlsAt(`localhost:${port}`)).toEqual([
      `http://localhost:${port}/api/github/sign-in/callback`,
      `http://localhost:${port}/api/sign-in/github/callback`,
      `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
    ]);
    // Behind the reverse proxy the request looks like plain HTTP: the public address is the setting's.
    expect(await callbackUrlsAt("office.example.com")).toEqual([
      `${PUBLIC_ADDRESS}/api/github/sign-in/callback`,
      `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
    ]);
  });

  it("lists Continue with GitHub's callback only here when The Office has no public address", async () => {
    const { port } = new URL(url);

    expect(await callbackUrlsAt(`127.0.0.1:${port}`)).toEqual([
      `http://127.0.0.1:${port}/api/github/sign-in/callback`,
      `http://127.0.0.1:${port}/api/sign-in/github/callback`,
    ]);
  });
});
