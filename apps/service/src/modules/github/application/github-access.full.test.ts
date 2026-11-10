import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubSignedOut } from "../domain/github-events.js";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
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
  it("signs out, saying why, when GitHub refuses the refresh", async () => {
    await signInWithGitHub();
    expireUserToken(MINUTE_MS);
    github.revokeRefreshTokens();
    published = [];

    expect(await access.userToken()).toBeUndefined();

    const reason = {
      text: "GitHub no longer accepts the sign-in: it was revoked on GitHub, or went unused for six months. Sign in again.",
    };
    expect(signIns.signIn).toEqual({ status: "signed-out", reason });
    expect(published).toEqual([expect.objectContaining({ reason })]);
    expect(published[0]).toBeInstanceOf(GitHubSignedOut);
    expect(await access.isSignedIn()).toBe(false);
    expect(await access.userToken()).toBeUndefined();
    expect(refreshes()).toBe(1);
  });

  it("signs out when GitHub refuses the App's client secret on a refresh", async () => {
    await signInWithGitHub();
    expireUserToken(MINUTE_MS);
    github.resetClientSecret(apps.app?.clientId ?? "");

    expect(await access.userToken()).toBeUndefined();

    expect(signIns.signIn).toEqual({
      status: "signed-out",
      reason: {
        text: "GitHub refused the App's Client ID and client secret: the App may have been deleted or its secret reset. Register the App again.",
      },
    });
  });

  it("signs out without asking GitHub once the refresh token has expired", async () => {
    await signInWithGitHub();
    signIns.signIn = {
      status: "signed-in",
      login: "office-user",
      tokens: {
        ...expireUserToken(-MINUTE_MS),
        refreshTokenExpiresAt: new Date(Date.now() - MINUTE_MS),
      },
    };

    expect(await access.userToken()).toBeUndefined();

    expect(signIns.signIn).toEqual({
      status: "signed-out",
      reason: {
        text: "The sign-in to GitHub ended: it can't be renewed after six months unused. Sign in again.",
      },
    });
    expect(refreshes()).toBe(0);
  });

  it("keeps a sign-out that comes in while a refresh runs", async () => {
    await signInWithGitHub();
    expireUserToken(MINUTE_MS);

    const [token] = await Promise.all([access.userToken(), signIn.signOut()]);

    expect(token).toMatch(/^ghu_fake/);
    expect(signIns.signIn).toBeUndefined();
    expect(await access.userToken()).toBeUndefined();
  });

  it("keeps the sign-in when GitHub can't be reached for the refresh, failing the command", async () => {
    await signInWithGitHub();
    const before = expireUserToken(MINUTE_MS);
    await github.close();
    githubClosed = true;

    await expect(access.userToken()).rejects.toThrow(GitHubAccessFailed);

    expect(signIns.signIn).toEqual({ status: "signed-in", login: "office-user", tokens: before });
  });

  it("keeps the sign-in when GitHub fails with a server error on the refresh, failing the command", async () => {
    await signInWithGitHub();
    const before = expireUserToken(MINUTE_MS);
    github.tokenEndpointDown = true;

    await expect(access.userToken()).rejects.toThrow(
      "GitHub couldn't answer renewing the sign-in (HTTP 503). The GitHub token couldn't be renewed; try again once GitHub can be reached.",
    );

    expect(signIns.signIn).toEqual({ status: "signed-in", login: "office-user", tokens: before });
  });

  it("says a renewed token that couldn't be kept in its own words, never the store's", async () => {
    await signInWithGitHub();
    expireUserToken(MINUTE_MS);
    signIns.replace = () => Promise.reject(new Error("Failed query: params: secret-token"));

    await expect(access.userToken()).rejects.toThrow(
      "The renewed GitHub token couldn't be kept. Try again; sign in again if it keeps failing.",
    );
  });

  it("lists every repository of the App's installations, every page, leaving out suspended ones", async () => {
    await signInWithGitHub();
    const many = Array.from({ length: 120 }, (_, index) => ({
      fullName: `office-org/repository-${String(index).padStart(3, "0")}`,
    }));
    github.installations.install("office-user", [
      { fullName: "office-user/private-notes", private: true },
    ]);
    github.installations.install("office-org", many);
    github.installations.install("suspended-org", [{ fullName: "suspended-org/old" }], {
      suspended: true,
    });

    const repositories = await access.repositories();

    expect(repositories).toHaveLength(121);
    expect(repositories[0]).toEqual({
      fullName: "office-org/repository-000",
      repositoryUrl: `${github.urls.web}/office-org/repository-000.git`,
      private: false,
      defaultBranch: "main",
      pushedAt: "2026-01-05T09:00:00Z",
      description: "",
    });
    expect(repositories.at(-1)).toMatchObject({
      fullName: "office-user/private-notes",
      private: true,
    });
    expect(
      github
        .requestsTo("/api/v3/user/installations")
        .map((request) => request.path + request.search),
    ).toEqual([
      "/api/v3/user/installations?per_page=100",
      "/api/v3/user/installations/100/repositories?per_page=100",
      "/api/v3/user/installations/101/repositories?per_page=100",
      "/api/v3/user/installations/101/repositories?per_page=100&page=2",
    ]);
  });

  it("can't list the repositories while signed out", async () => {
    await expect(access.repositories()).rejects.toThrow(NotSignedInWithGitHub);
  });
});
