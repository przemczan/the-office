import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { GitHubAccess, GitHubModule } from "../../../github/index.js";
import {
  FakeGitHub,
  registeredGitHubAppForTests,
  signedInWithGitHubForTests,
} from "../../../github/index.fixtures.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import { cookieNamed, locationOf } from "../../linked-identities.fixtures.js";
import { atLocalhost, sendFrom, signedInAt, type PageAt } from "../../passkeys.fixtures.js";
import {
  send,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { IDENTITY_TRIP_COOKIE } from "../http/identity-trip-cookie.js";
import { SIGN_IN_COOKIE } from "../http/sign-in-cookie.js";
import { linkedIdentities } from "../postgres/linked-identities.schema.js";
import { signedInDevices } from "../postgres/users.schema.js";
import { GitHubIdentityProvider } from "./github-identity-provider.js";

let github: FakeGitHub;
let office: UsersApplication;
let localhost: PageAt;
let me: UserForTests;
let gitIdentityToken: string;
let published: DomainEvent[];

beforeEach(async () => {
  github = await FakeGitHub.start();
  // The same GitHub user as the git identity's.
  github.signedInUser = "office-user";
  const app = github.registerApp(["http://localhost/api/github/sign-in/callback"]);
  gitIdentityToken = github.issueUserToken("office-user");
  office = await startUsersApplication({
    identityProviders: {
      imports: [GitHubModule.register(github.urls)],
      identityProviders: [GitHubIdentityProvider],
    },
    overrides: [registeredGitHubAppForTests(app), signedInWithGitHubForTests(gitIdentityToken)],
  });
  localhost = atLocalhost(office.port);
  // Its port known, the App lists this Office's callback URL, as the owner adds it on GitHub.
  github.addCallbackUrl(app.clientId, `${localhost.origin}/api/sign-in/github/callback`);
  me = await addUser(office.app);
  published = [];
  office.app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await office.app.close();
  await github.close();
});

/** Follows GitHub's authorize page back to The Office's callback, as the browser does. */
async function throughGitHub(authorizeUrl: string, cookie: string): Promise<Answer> {
  const atGitHub = await fetch(authorizeUrl, { redirect: "manual" });
  const back = new URL(atGitHub.headers.get("location") ?? "");
  return send(office.port, {
    path: `${back.pathname}${back.search}`,
    host: localhost.host,
    headers: { cookie },
  });
}

async function authorizeUrlOf(
  path: string,
  cookie?: string,
): Promise<{ url: string; cookie: string }> {
  const answer = await sendFrom(office.port, localhost, {
    method: "POST",
    path,
    body: {},
    ...(cookie !== undefined && { cookie }),
  });
  expect(answer.status).toBe(200);
  const trip = cookieNamed(answer, IDENTITY_TRIP_COOKIE);
  return {
    url: (answer.body as { authorizeUrl: string }).authorizeUrl,
    cookie: [cookie, trip === undefined ? undefined : `${IDENTITY_TRIP_COOKIE}=${trip}`]
      .filter(Boolean)
      .join("; "),
  };
}

describe("Continue with GitHub through the GitHub App", () => {
  it("links and signs in by GitHub's numeric id as the git identity's login, leaving Sign in with GitHub and its token as they were", async () => {
    const access = office.app.get(GitHubAccess);
    const signedIn = await signedInAt(office.port, localhost, me);

    const linking = await authorizeUrlOf("/api/account/linked-identities/github", signedIn);
    const linked = await throughGitHub(linking.url, linking.cookie);
    const signingIn = await authorizeUrlOf("/api/sign-in/github");
    const signedInAgain = await throughGitHub(signingIn.url, signingIn.cookie);

    expect(locationOf(linked).pathname).toBe("/account/linked-identities");
    expect(locationOf(linked).searchParams.get("linkFailed")).toBeNull();
    expect(locationOf(signedInAgain).pathname).toBe("/");
    expect(cookieNamed(signedInAgain, SIGN_IN_COOKIE)).toBeTruthy();
    const database = office.app.get<Database>(DATABASE);
    const rows = await database
      .select()
      .from(linkedIdentities)
      .where(eq(linkedIdentities.userId, me.id));
    expect(rows).toEqual([
      expect.objectContaining({
        provider: "github",
        subject: String(github.userIdOf("office-user")),
        name: "office-user",
      }),
    ]);
    // The git identity is untouched: same token, no sign-in event.
    expect(await access.userToken()).toBe(gitIdentityToken);
    expect(published.map((event) => event.constructor.name)).not.toEqual(
      expect.arrayContaining(["GitHubSignedIn"]),
    );
    expect(published.map((event) => event.constructor.name)).not.toEqual(
      expect.arrayContaining(["GitHubSignedOut"]),
    );
    // Each token handed out for Continue with GitHub is revoked, and kept nowhere.
    const handedOut = github.issuedTokens.filter(
      (token) => token !== gitIdentityToken && token.startsWith("ghu_"),
    );
    expect(handedOut).toHaveLength(2);
    expect(github.revokedTokens).toEqual(handedOut);
    expect(github.authorizeScopes).toEqual([null, null]);
    const devices = await database
      .select()
      .from(signedInDevices)
      .where(eq(signedInDevices.userId, me.id));
    const kept = JSON.stringify([rows, devices, published, linked.headers, signedInAgain.headers]);
    for (const token of github.issuedTokens.filter((issued) => issued !== gitIdentityToken)) {
      expect(kept).not.toContain(token);
    }
  });
});
