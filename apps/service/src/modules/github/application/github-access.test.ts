import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubSignedOut } from "../domain/github-events.js";
import type { UserTokens } from "../domain/sign-in.js";
import { FakeGitHub } from "../index.fixtures.js";
import { GitHubAppForTests } from "../ports/github-app-repository.fixtures.js";
import { GitHubSignInForTests } from "../ports/github-sign-in-repository.fixtures.js";
import { GitHubAccess } from "./github-access.js";
import { GitHubSignIn } from "./github-sign-in.js";
import { SignInChanges } from "./sign-in-changes.js";

const CALLBACK = "http://office.test/api/github/sign-in/callback";
const MINUTE_MS = 60 * 1000;

let github: FakeGitHub;
let githubClosed: boolean;
let api: GitHubRestApi;
let apps: GitHubAppForTests;
let signIns: GitHubSignInForTests;
let published: DomainEvent[];
let signIn: GitHubSignIn;
let access: GitHubAccess;

beforeEach(async () => {
  github = await FakeGitHub.start();
  githubClosed = false;
  api = new GitHubRestApi(github.urls);
  apps = new GitHubAppForTests();
  signIns = new GitHubSignInForTests();
  const events = new EventBus();
  published = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  const changes = new SignInChanges();
  signIn = new GitHubSignIn(github.urls, api, apps, signIns, events, changes);
  access = new GitHubAccess(api, apps, signIns, events, changes, github.urls);
});

afterEach(async () => {
  if (!githubClosed) await github.close();
});

/** Registers the App on the fake GitHub and signs in through it, as the browser would. */
async function signInWithGitHub(): Promise<void> {
  const registered = await fetch(`${github.urls.web}/settings/apps/new`, {
    method: "POST",
    body: new URLSearchParams({
      manifest: JSON.stringify({ redirect_url: "http://office.test/", callback_urls: [CALLBACK] }),
    }),
    redirect: "manual",
  });
  const code = new URL(registered.headers.get("location") ?? "").searchParams.get("code") ?? "";
  apps.app = await api.convertManifestCode(code);
  const atGitHub = await fetch(await signIn.authorizeUrl(CALLBACK), { redirect: "manual" });
  const back = new URL(atGitHub.headers.get("location") ?? "").searchParams;
  await signIn.complete({
    code: back.get("code") ?? undefined,
    state: back.get("state") ?? undefined,
    error: undefined,
  });
}

function keptTokens(): UserTokens {
  const kept = signIns.signIn;
  if (kept?.status !== "signed-in") throw new Error(`Not signed in: ${JSON.stringify(kept)}`);
  return kept.tokens;
}

/** The kept tokens, with the user token expiring `inMs` from now. */
function expireUserToken(inMs: number): UserTokens {
  const tokens = { ...keptTokens(), accessTokenExpiresAt: new Date(Date.now() + inMs) };
  signIns.signIn = { status: "signed-in", login: "office-user", tokens };
  return tokens;
}

function refreshes(): number {
  return github.requests.filter((request) => request.grantType === "refresh_token").length;
}

describe("GitHubAccess", () => {
  it("gives the kept token, without asking GitHub, while it is far from expiring", async () => {
    await signInWithGitHub();

    expect(await access.userToken()).toBe(keptTokens().accessToken);
    expect(refreshes()).toBe(0);
  });

  it("refreshes the token near its expiry, keeping both new tokens; the ones before stop working", async () => {
    await signInWithGitHub();
    const before = expireUserToken(5 * MINUTE_MS);

    const token = await access.userToken();

    const after = keptTokens();
    expect(token).toBe(after.accessToken);
    expect(after.accessToken).not.toBe(before.accessToken);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 7 * 60 * MINUTE_MS);
    expect((await api.userOf(after.accessToken)).login).toBe("office-user");
    await expect(api.userOf(before.accessToken)).rejects.toThrow("HTTP 401");
    // The client secret and refresh token travel in the body, never in a URL.
    expect(github.requests.filter((request) => request.grantType === "refresh_token")).toEqual([
      expect.objectContaining({ method: "POST", search: "", accept: "application/json" }),
    ]);
    expect(published.filter((event) => event instanceof GitHubSignedOut)).toEqual([]);
  });

  it("refreshes once for callers that need the token at the same time, each getting the new one", async () => {
    await signInWithGitHub();
    const before = expireUserToken(-MINUTE_MS);
    github.installations.install("office-user", [{ fullName: "office-user/notes" }]);

    const [first, second, repositories] = await Promise.all([
      access.userToken(),
      access.userToken(),
      access.repositories(),
    ]);

    expect(refreshes()).toBe(1);
    expect(first).toBe(keptTokens().accessToken);
    expect(second).toBe(first);
    expect(first).not.toBe(before.accessToken);
    expect(repositories.map((repository) => repository.fullName)).toEqual(["office-user/notes"]);
  });
});
