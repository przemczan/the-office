import type { INestApplication } from "@nestjs/common";
import {
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  gitHubAppManifestFormSchema,
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

const app1 = { slug: "the-office-fake-1", owner: "office-user" };

describe("/api/github", () => {
  it("can't sign in before the App is registered", async () => {
    expect(await state()).toEqual({ status: "not-registered" });

    const response = await office("/api/github/sign-in", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: "Register the GitHub App first: Sign in with GitHub signs in through it.",
    });
  });

  it("sends the browser to GitHub's authorize page with a state and PKCE, back to this Office", async () => {
    await registerApp();
    expect(await state()).toEqual({ status: "signed-out", app: app1 });

    const authorize = await authorizeUrl();

    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      `${github.urls.web}/login/oauth/authorize`,
    );
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      client_id: "Iv23liFake1",
      redirect_uri: `${url}/api/github/sign-in/callback`,
      state: expect.stringMatching(/^[\w-]{32}$/),
      scope: "offline_access",
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
    });
  });

  it("exchanges the code GitHub sends back with and keeps the tokens, never showing them", async () => {
    await registerApp();
    published = [];

    const landing = await signInThroughGitHub();

    expect(failureOf(landing)).toBeNull();
    expect(await state()).toEqual({ status: "signed-in", app: app1, login: "office-user" });
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

  it("refuses to sign in again while signed in, and signs out by forgetting the tokens", async () => {
    await registerApp();
    await signInThroughGitHub();

    const again = await office("/api/github/sign-in", { method: "POST" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      message:
        "Already signed in to GitHub as office-user. Sign out first to sign in as someone else.",
    });

    published = [];
    expect((await office("/api/github/sign-in", { method: "DELETE" })).status).toBe(204);

    expect(signIns.signIn).toBeUndefined();
    expect(await state()).toEqual({ status: "signed-out", app: app1 });
    expect(webEvents()).toEqual([{ type: "github.changed" }]);
  });

  it("says so when the user cancels on GitHub", async () => {
    await registerApp();
    github.cancelAuthorization = true;

    const landing = await signInThroughGitHub();

    expect(failureOf(landing)).toBe("The sign-in was cancelled on GitHub. Sign in again.");
    expect(exchanges()).toBe(0);
    expect(await state()).toEqual({ status: "signed-out", app: app1 });
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

  it("says why when GitHub refuses the App's client secret", async () => {
    await registerApp();
    github.resetClientSecret("Iv23liFake1");

    const landing = await signInThroughGitHub();

    expect(failureOf(landing)).toBe(
      "GitHub refused the App's Client ID and client secret: the App may have been deleted or its secret reset. Register the App again.",
    );
    expect(signIns.signIn).toBeUndefined();
  });

  it("signs out, saying why, when the App is registered again", async () => {
    await registerApp();
    await signInThroughGitHub();
    published = [];

    await registerApp();

    expect(await state()).toEqual({
      status: "signed-out",
      app: { slug: "the-office-fake-2", owner: "office-user" },
      reason: {
        text: "The GitHub App was registered again, so the sign-in under the one before ended. Sign in again.",
      },
    });
    expect(webEvents()).toEqual([{ type: "github.changed" }, { type: "github.changed" }]);
  });

  it("ends a sign-in begun under the App registered before", async () => {
    await registerApp();
    const authorize = await authorizeUrl();
    await registerApp();

    const landing = await signInThroughGitHub(authorize);

    expect(failureOf(landing)).toBe(
      "The GitHub App was registered again during the sign-in. Sign in again.",
    );
    expect(exchanges()).toBe(0);
    expect(signIns.signIn).toBeUndefined();
  });
});
