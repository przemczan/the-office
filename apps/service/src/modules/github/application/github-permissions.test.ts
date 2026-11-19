import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubPermissionsChecked, GitHubSignedIn } from "../domain/github-events.js";
import { FakeGitHub } from "../index.fixtures.js";
import { GitHubAppForTests } from "../ports/github-app-repository.fixtures.js";
import { GitHubSignInForTests } from "../ports/github-sign-in-repository.fixtures.js";
import { GitHubAccess } from "./github-access.js";
import { GitHubPermissions } from "./github-permissions.js";
import { SignInChanges } from "./sign-in-changes.js";

const ALL_GRANTED = {
  metadata: "read",
  contents: "write",
  pull_requests: "write",
  workflows: "write",
  checks: "read",
  statuses: "read",
  actions: "write",
} as const;

let github: FakeGitHub;
let events: EventBus;
let permissions: GitHubPermissions;

beforeEach(async () => {
  github = await FakeGitHub.start();
  const api = new GitHubRestApi(github.urls);
  const apps = new GitHubAppForTests();
  apps.app = {
    clientId: "Iv23liFake1",
    clientSecret: "secret",
    slug: "the-office",
    owner: "office-user",
  };
  const signIns = new GitHubSignInForTests();
  signIns.signIn = {
    status: "signed-in",
    login: "office-user",
    tokens: {
      accessToken: github.issueUserToken("office-user"),
      accessTokenExpiresAt: undefined,
      refreshToken: undefined,
      refreshTokenExpiresAt: undefined,
    },
  };
  events = new EventBus();
  const changes = new SignInChanges();
  const access = new GitHubAccess(api, apps, signIns, events, changes, github.urls);
  permissions = new GitHubPermissions(api, apps, signIns, events, github.urls, access);
  permissions.onModuleInit();
});

afterEach(async () => {
  permissions.onModuleDestroy();
  vi.useRealTimers();
  await github.close();
});

function installationReads(): number {
  return github.requestsTo("/api/v3/user/installations").length;
}

describe("the permissions the App's installations lack", () => {
  it("lists each missing permission once, with where to add and accept them", async () => {
    github.installations.install("office-user", [{ fullName: "office-user/notes" }]);
    github.installations.install("office", [{ fullName: "office/tools" }], {
      accountType: "Organization",
      permissions: { ...ALL_GRANTED, actions: "read" },
    });
    github.installations.install("elsewhere", [], { permissions: ALL_GRANTED });

    await expect(permissions.lacking()).resolves.toEqual({
      missing: [
        { name: "checks", level: "read" },
        { name: "statuses", level: "read" },
        { name: "actions", level: "write" },
      ],
      appPermissionsUrl: `${github.urls.web}/settings/apps/the-office/permissions`,
      installations: [
        { account: "office-user", acceptUrl: `${github.urls.web}/settings/installations/100` },
        {
          account: "office",
          acceptUrl: `${github.urls.web}/organizations/office/settings/installations/101`,
        },
      ],
    });
  });

  it("is nothing when every installation granted them all, a higher level counting", async () => {
    github.installations.install("office-user", [], {
      permissions: { ...ALL_GRANTED, checks: "write", metadata: "admin" },
    });

    await expect(permissions.lacking()).resolves.toBeUndefined();
  });

  it("keeps the answer five minutes, and reads GitHub again on Check again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    github.installations.install("office-user", []);
    const published: unknown[] = [];
    events.subscribe(GitHubPermissionsChecked, (event) => void published.push(event));
    await permissions.lacking();
    await permissions.lacking();
    expect(installationReads()).toBe(1);

    github.installations.grant("office-user", ALL_GRANTED);
    await expect(permissions.checkAgain()).resolves.toBeUndefined();
    expect(installationReads()).toBe(2);
    expect(published).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await permissions.lacking();
    expect(installationReads()).toBe(3);
  });

  it("drops the answer when the user signs in again", async () => {
    github.installations.install("office-user", []);
    await permissions.lacking();

    await events.publish(new GitHubSignedIn("office-user"));
    await permissions.lacking();

    expect(installationReads()).toBe(2);
  });

  it("is nothing when GitHub can't be asked", async () => {
    github.installations.install("office-user", []);
    await github.close();
    github = await FakeGitHub.start();

    await expect(permissions.lacking()).resolves.toBeUndefined();
  });
});
