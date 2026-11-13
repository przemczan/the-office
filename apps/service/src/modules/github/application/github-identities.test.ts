import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubIdentityFailed } from "../domain/github-identity.js";
import { FakeGitHub } from "../index.fixtures.js";
import { GitHubAppForTests } from "../ports/github-app-repository.fixtures.js";
import { GitHubSignInForTests } from "../ports/github-sign-in-repository.fixtures.js";
import { GitHubAccess } from "./github-access.js";
import { GitHubIdentities } from "./github-identities.js";
import { GitHubSignIn } from "./github-sign-in.js";
import { SignInChanges } from "./sign-in-changes.js";

const GIT_IDENTITY_CALLBACK = "http://office.test/api/github/sign-in/callback";
const IDENTITY_CALLBACK = "http://office.test/api/sign-in/github/callback";
const CODE_VERIFIER = "a-code-verifier-of-43-characters-or-more-0123";

let github: FakeGitHub;
let api: GitHubRestApi;
let apps: GitHubAppForTests;
let signIns: GitHubSignInForTests;
let published: DomainEvent[];
let signIn: GitHubSignIn;
let access: GitHubAccess;
let identities: GitHubIdentities;

beforeEach(async () => {
  github = await FakeGitHub.start();
  api = new GitHubRestApi(github.urls);
  apps = new GitHubAppForTests();
  signIns = new GitHubSignInForTests();
  const events = new EventBus();
  published = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  const changes = new SignInChanges();
  signIn = new GitHubSignIn(github.urls, api, apps, signIns, events, changes);
  access = new GitHubAccess(api, apps, signIns, events, changes, github.urls);
  identities = new GitHubIdentities(github.urls, api, apps);
});

afterEach(async () => {
  await github.close();
});

async function registerApp(): Promise<void> {
  const registered = await fetch(`${github.urls.web}/settings/apps/new`, {
    method: "POST",
    body: new URLSearchParams({
      manifest: JSON.stringify({
        redirect_url: "http://office.test/",
        callback_urls: [GIT_IDENTITY_CALLBACK, IDENTITY_CALLBACK],
      }),
    }),
    redirect: "manual",
  });
  const code = new URL(registered.headers.get("location") ?? "").searchParams.get("code") ?? "";
  apps.app = await api.convertManifestCode(code);
}

/** Where the authorize page sends the browser back, as the browser would follow it. */
async function visit(authorizeUrl: string): Promise<URLSearchParams> {
  const atGitHub = await fetch(authorizeUrl, { redirect: "manual" });
  return new URL(atGitHub.headers.get("location") ?? "").searchParams;
}

async function signInGitIdentity(): Promise<void> {
  const back = await visit(await signIn.authorizeUrl(GIT_IDENTITY_CALLBACK));
  await signIn.complete({
    code: back.get("code") ?? undefined,
    state: back.get("state") ?? undefined,
    error: undefined,
  });
}

async function continueWithGitHub(): Promise<{ subject: string; name: string }> {
  const authorizeUrl = await identities.authorizeUrl({
    state: "a-state",
    codeVerifier: CODE_VERIFIER,
    redirectUri: IDENTITY_CALLBACK,
  });
  const back = await visit(authorizeUrl);
  expect(back.get("state")).toBe("a-state");
  return identities.identityOf({
    code: back.get("code") ?? undefined,
    error: back.get("error") ?? undefined,
    codeVerifier: CODE_VERIFIER,
    redirectUri: IDENTITY_CALLBACK,
  });
}

describe("GitHubIdentities", () => {
  it("is available only once the App is registered", async () => {
    expect(await identities.isAvailable()).toBe(false);
    await expect(
      identities.authorizeUrl({
        state: "s",
        codeVerifier: CODE_VERIFIER,
        redirectUri: IDENTITY_CALLBACK,
      }),
    ).rejects.toThrow(GitHubIdentityFailed);

    await registerApp();

    expect(await identities.isAvailable()).toBe(true);
  });

  it("asks GitHub for no scope, with PKCE S256, and answers GitHub's numeric id and the login", async () => {
    await registerApp();
    github.signedInUser = "ada";

    const identity = await continueWithGitHub();

    expect(identity).toEqual({ subject: String(github.userIdOf("ada")), name: "ada" });
    expect(github.authorizeScopes).toEqual([null]);
    const authorize = github.requestsTo("/login/oauth/authorize")[0];
    expect(new URLSearchParams(authorize?.search).get("code_challenge_method")).toBe("S256");
  });

  it("uses the token once for GET /user, then revokes that token alone, and answers none of it", async () => {
    await registerApp();

    const identity = await continueWithGitHub();

    const [token] = github.issuedTokens;
    expect(github.revokedTokens).toEqual([token]);
    expect(github.requestsTo("/api/v3/user")).toHaveLength(1);
    expect(github.requestsTo(`/api/v3/applications/${apps.app?.clientId}/token`)).toHaveLength(1);
    expect(github.requestsTo(`/api/v3/applications/${apps.app?.clientId}/grant`)).toHaveLength(0);
    expect(JSON.stringify(identity)).not.toContain(token);
  });

  it("leaves Sign in with GitHub as it was when the same GitHub user continues with GitHub", async () => {
    await registerApp();
    await signInGitIdentity();
    const keptBefore = signIns.signIn;
    const tokenBefore = await access.userToken();
    const eventsBefore = published.length;

    const identity = await continueWithGitHub();

    expect(identity.name).toBe("office-user");
    expect(signIns.signIn).toEqual(keptBefore);
    expect(await access.userToken()).toBe(tokenBefore);
    expect(published).toHaveLength(eventsBefore);
    expect(github.revokedTokens).not.toContain(tokenBefore);
    // The git identity's token still works on GitHub.
    expect((await api.userOf(tokenBefore ?? "")).login).toBe("office-user");
  });

  it("words a cancel on GitHub and a code GitHub no longer knows", async () => {
    await registerApp();

    await expect(
      identities.identityOf({
        code: undefined,
        error: "access_denied",
        codeVerifier: CODE_VERIFIER,
        redirectUri: IDENTITY_CALLBACK,
      }),
    ).rejects.toThrow("cancelled on GitHub");
    await expect(
      identities.identityOf({
        code: "unknown",
        error: undefined,
        codeVerifier: CODE_VERIFIER,
        redirectUri: IDENTITY_CALLBACK,
      }),
    ).rejects.toThrow("GitHub no longer knows");
  });
});

describe("GitHubSignIn", () => {
  it("says to add this address's callback URL when GitHub sends a mismatch it didn't start", async () => {
    await registerApp();

    await expect(
      signIn.complete({ code: undefined, state: "not-ours", error: "redirect_uri_mismatch" }),
    ).rejects.toThrow("callback URL isn't in the GitHub App's settings");
  });
});
