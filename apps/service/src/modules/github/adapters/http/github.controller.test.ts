import type { INestApplication } from "@nestjs/common";
import {
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  gitHubAppManifestFormSchema,
  gitHubRepositoryListSchema,
  gitHubSignInSchema,
  gitHubStateSchema,
  gitHubWebEventSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubState,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { GitHubModule } from "../../github.module.js";
import { FAKE_GITHUB_SECRETS, FAKE_TOKEN_PREFIXES, FakeGitHub } from "../../index.fixtures.js";
import { GitHubAppRepository } from "../../ports/github-app-repository.js";
import { GitHubAppForTests } from "../../ports/github-app-repository.fixtures.js";
import { GitHubSignInRepository } from "../../ports/github-sign-in-repository.js";
import { GitHubSignInForTests } from "../../ports/github-sign-in-repository.fixtures.js";

const HOUR_MS = 60 * 60 * 1000;

let github: FakeGitHub;
let app: INestApplication;
let url: string;
let signIns: GitHubSignInForTests;
let published: DomainEvent[];
/** Every answer The Office gave the browser, to check none holds a token or the client secret. */
let answers: string[];

beforeEach(async () => {
  github = await FakeGitHub.start();
  signIns = new GitHubSignInForTests();
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EventStreamModule, GitHubModule.register(github.urls)],
    overrides: [
      { provide: GitHubAppRepository, useValue: new GitHubAppForTests() },
      { provide: GitHubSignInRepository, useValue: signIns },
    ],
  }));
  published = [];
  answers = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
  await github.close();
});

async function office(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${url}${path}`, { redirect: "manual", ...init });
  answers.push(`${response.headers.get("location") ?? ""} ${await response.clone().text()}`);
  return response;
}

async function state(): Promise<GitHubState> {
  const response = await office("/api/github");
  expect(response.status).toBe(200);
  return gitHubStateSchema.parse(await response.json());
}

/** Registers the App from this Office by its manifest, through the fake GitHub. */
async function registerApp(): Promise<void> {
  const form = gitHubAppManifestFormSchema.parse(
    await (await office("/api/github/app/manifest")).json(),
  );
  const backFromGitHub = await fetch(form.action, {
    method: "POST",
    body: new URLSearchParams({ manifest: form.manifest }),
    redirect: "manual",
  });
  await fetch(backFromGitHub.headers.get("location") ?? "", { redirect: "manual" });
}

async function authorizeUrl(): Promise<URL> {
  const response = await office("/api/github/sign-in", { method: "POST" });
  expect(response.status).toBe(200);
  return new URL(gitHubSignInSchema.parse(await response.json()).authorizeUrl);
}

/** Goes to GitHub's authorize page and back, as the browser does; returns where it lands. */
async function signInThroughGitHub(authorize?: URL): Promise<URL> {
  const atGitHub = await fetch(authorize ?? (await authorizeUrl()), { redirect: "manual" });
  expect(atGitHub.status).toBe(302);
  const back = new URL(atGitHub.headers.get("location") ?? "");
  const landing = await office(`${back.pathname}${back.search}`);
  expect(landing.status).toBe(302);
  return new URL(landing.headers.get("location") ?? "", url);
}

function failureOf(landing: URL): string | null {
  expect(landing.pathname).toBe(OFFICE_IDENTITY_SETTINGS_PATH);
  return landing.searchParams.get(GITHUB_SIGN_IN_FAILED_PARAMETER);
}

function exchanges(): number {
  return github.requestsTo("/login/oauth/access_token").length;
}

function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = gitHubWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** The App as the web sees it, its install page on the fake GitHub. */
function registeredApp(slug = "the-office-fake-1") {
  return {
    slug,
    owner: "office-user",
    installUrl: `${github.urls.web}/apps/${slug}/installations/new`,
  };
}

describe("/api/github", () => {
  it("can't sign in before the App is registered", async () => {
    expect(await state()).toEqual({ status: "not-registered" });

    const response = await office("/api/github/sign-in", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: "Register the GitHub App first: Sign in with GitHub signs in through it.",
    });
  });

  it("exchanges the code GitHub sends back with and keeps the tokens, never showing them", async () => {
    await registerApp();
    published = [];

    const landing = await signInThroughGitHub();

    expect(failureOf(landing)).toBeNull();
    expect(await state()).toEqual({
      status: "signed-in",
      app: registeredApp(),
      login: "office-user",
      permissions: null,
    });
    const kept = signIns.signIn;
    expect(kept).toEqual({
      status: "signed-in",
      login: "office-user",
      tokens: {
        accessToken: expect.stringMatching(/^ghu_fake/),
        accessTokenExpiresAt: expect.any(Date),
        refreshToken: expect.stringMatching(/^ghr_fake/),
        refreshTokenExpiresAt: expect.any(Date),
      },
    });
    if (kept?.status !== "signed-in") return;
    expect(kept.tokens.accessTokenExpiresAt?.getTime()).toBeCloseTo(Date.now() + 8 * HOUR_MS, -4);
    expect(kept.tokens.refreshTokenExpiresAt?.getTime()).toBeCloseTo(
      Date.now() + 15897600 * 1000,
      -4,
    );
    expect(webEvents()).toEqual([{ type: "github.changed" }]);
    const shown = JSON.stringify([answers, published]);
    for (const secret of [
      ...github.issuedTokens,
      ...FAKE_TOKEN_PREFIXES,
      FAKE_GITHUB_SECRETS.clientSecret,
    ]) {
      expect(shown).not.toContain(secret);
    }
    // The client secret and the code travel in the body, never in a URL.
    expect(github.requestsTo("/login/oauth/access_token")).toEqual([
      expect.objectContaining({ method: "POST", search: "", accept: "application/json" }),
    ]);
  });

  it("refuses a code that came back without a state this Office handed out, taking each state once", async () => {
    await registerApp();
    const authorize = await authorizeUrl();
    await signInThroughGitHub(authorize);
    await office("/api/github/sign-in", { method: "DELETE" });

    const forged = await office("/api/github/sign-in/callback?code=abc&state=not-from-this-office");
    const replayed = await signInThroughGitHub(authorize);

    for (const landing of [new URL(forged.headers.get("location") ?? "", url), replayed]) {
      expect(failureOf(landing)).toBe(
        "This sign-in wasn't started from this Office, or took longer than ten minutes. Sign in again.",
      );
    }
    expect(exchanges()).toBe(1);
    expect(signIns.signIn).toBeUndefined();
  });

  it("lists the repositories the App is installed on, never showing a token", async () => {
    await registerApp();
    await signInThroughGitHub();
    github.installations.install("office-user", [
      {
        fullName: "office-user/notes",
        private: true,
        pushedAt: "2026-10-30T14:05:00Z",
        description: "Notes on the office.",
      },
    ]);

    const response = await office("/api/github/repositories");

    expect(response.status).toBe(200);
    expect(gitHubRepositoryListSchema.parse(await response.json())).toEqual([
      {
        fullName: "office-user/notes",
        repositoryUrl: `${github.urls.web}/office-user/notes.git`,
        private: true,
        defaultBranch: "main",
        pushedAt: "2026-10-30T14:05:00Z",
        description: "Notes on the office.",
      },
    ]);
    const shown = answers.join("\n");
    for (const secret of [...github.issuedTokens, FAKE_GITHUB_SECRETS.clientSecret]) {
      expect(shown).not.toContain(secret);
    }
  });

  it("says which permissions the installations lack, and reads them again on Check again", async () => {
    await registerApp();
    await signInThroughGitHub();
    github.installations.install("office-user", [{ fullName: "office-user/notes" }]);

    expect(await state()).toEqual({
      status: "signed-in",
      app: registeredApp(),
      login: "office-user",
      permissions: {
        missing: [
          { name: "checks", level: "read" },
          { name: "statuses", level: "read" },
          { name: "actions", level: "write" },
          { name: "issues", level: "write" },
        ],
        appPermissionsUrl: `${github.urls.web}/settings/apps/the-office-fake-1/permissions`,
        installations: [
          { account: "office-user", acceptUrl: `${github.urls.web}/settings/installations/100` },
        ],
      },
    });

    github.installations.grant("office-user", {
      checks: "read",
      statuses: "read",
      actions: "write",
      issues: "write",
    });
    published = [];
    const checked = await office("/api/github/permissions/check", { method: "POST" });

    expect(checked.status).toBe(200);
    expect(gitHubStateSchema.parse(await checked.json())).toMatchObject({
      status: "signed-in",
      permissions: null,
    });
    expect(webEvents()).toEqual([{ type: "github.changed" }]);
  });
});
