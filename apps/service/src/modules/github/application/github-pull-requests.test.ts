import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { NotSignedInWithGitHub } from "../domain/github-repository.js";
import { FakeGitHub } from "../index.fixtures.js";
import { GitHubAppForTests } from "../ports/github-app-repository.fixtures.js";
import { GitHubSignInForTests } from "../ports/github-sign-in-repository.fixtures.js";
import { GitHubAccess } from "./github-access.js";
import { GitHubPullRequests, type PullRequestOnRemote } from "./github-pull-requests.js";
import { SignInChanges } from "./sign-in-changes.js";

let github: FakeGitHub;
let signIns: GitHubSignInForTests;
let pullRequests: GitHubPullRequests;

beforeEach(async () => {
  github = await FakeGitHub.start();
  github.installations.install("office", [{ fullName: "office/tools" }]);
  const api = new GitHubRestApi(github.urls);
  signIns = new GitHubSignInForTests();
  const access = new GitHubAccess(
    api,
    new GitHubAppForTests(),
    signIns,
    new EventBus(),
    new SignInChanges(),
    github.urls,
  );
  pullRequests = new GitHubPullRequests(api, access, github.urls);
});

afterEach(async () => {
  await github.close();
});

function signIn(): void {
  const accessToken = github.issueUserToken();
  signIns.signIn = {
    status: "signed-in",
    login: github.signedInUser,
    tokens: {
      accessToken,
      accessTokenExpiresAt: undefined,
      refreshToken: undefined,
      refreshTokenExpiresAt: undefined,
    },
  };
}

function aPullRequest(overrides: Partial<PullRequestOnRemote> = {}): PullRequestOnRemote {
  return {
    remoteUrl: `${github.urls.web}/office/tools.git`,
    base: "main",
    head: "office/task-1",
    title: "Rename a device",
    body: "## Definition of Done\n\n- [x] The rename persists",
    ...overrides,
  };
}

describe("opening a pull request on GitHub", () => {
  it("opens it through the REST API as the signed-in user, in the record's words", async () => {
    signIn();

    await expect(pullRequests.open(aPullRequest())).resolves.toEqual({
      number: 1,
      url: `${github.urls.web}/office/tools/pull/1`,
    });
    expect(github.pullRequests.opened).toEqual([
      expect.objectContaining({
        repository: "office/tools",
        head: "office/task-1",
        base: "main",
        title: "Rename a device",
        body: "## Definition of Done\n\n- [x] The rename persists",
      }),
    ]);
  });

  it("finds the one already open for the branch when Publish runs again", async () => {
    signIn();
    await pullRequests.open(aPullRequest());

    await expect(pullRequests.open(aPullRequest({ title: "Again" }))).resolves.toEqual({
      number: 1,
      url: `${github.urls.web}/office/tools/pull/1`,
    });
    expect(github.pullRequests.opened).toHaveLength(1);
    expect(github.requestsTo("/api/v3/repos/office/tools/pulls").at(-1)?.search).toBe(
      "?state=open&head=office%3Aoffice%2Ftask-1&base=main",
    );
  });
});

function remoteUrl(): string {
  return `${github.urls.web}/office/tools.git`;
}

describe("reading the pull requests on GitHub", () => {
  it("lists the open ones with their branches and commits", async () => {
    signIn();
    await pullRequests.open(aPullRequest());
    await pullRequests.open(aPullRequest({ head: "office/task-2", title: "Closed" }));
    github.pullRequests.close("office/tools", 2);
    const [opened] = github.pullRequests.opened;

    await expect(pullRequests.openPullRequests(remoteUrl())).resolves.toEqual([
      {
        number: 1,
        url: `${github.urls.web}/office/tools/pull/1`,
        title: "Rename a device",
        branch: "office/task-1",
        baseBranch: "main",
        headCommit: opened?.headSha,
        baseCommit: opened?.baseSha,
      },
    ]);
  });

  it("gives where one stands: its state, its head's checks and whether it merges", async () => {
    signIn();
    await pullRequests.open(aPullRequest());
    const [opened] = github.pullRequests.opened;

    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toEqual({
      state: "open",
      checks: "none",
      mergeable: "yes",
      headCommit: opened?.headSha,
      baseCommit: opened?.baseSha,
    });

    github.pullRequests.setChecks("office/tools", 1, "failing");
    github.pullRequests.setMergeable("office/tools", 1, false);
    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toMatchObject({
      checks: "failing",
      mergeable: "conflicts",
    });

    github.pullRequests.pushHead("office/tools", 1);
    github.pullRequests.merge("office/tools", 1);
    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toMatchObject({
      state: "merged",
      checks: "none",
    });
  });

  it("gives the checks as unknown when GitHub refuses to show them", async () => {
    signIn();
    await pullRequests.open(aPullRequest());
    github.pullRequests.setChecks("office/tools", 1, "passing");
    github.pullRequests.checksRefused.add("office/tools");

    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toMatchObject({
      state: "open",
      checks: "unknown",
    });
  });

  it("asks again by ETag and reuses the answer GitHub says hasn't changed", async () => {
    signIn();
    await pullRequests.open(aPullRequest());
    const first = await pullRequests.status(remoteUrl(), 1);
    const firstList = await pullRequests.openPullRequests(remoteUrl());
    expect(github.notModified).toEqual([]);

    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toEqual(first);
    await expect(pullRequests.openPullRequests(remoteUrl())).resolves.toEqual(firstList);

    expect(github.notModified.map((request) => request.path)).toEqual([
      "/api/v3/repos/office/tools/pulls/1",
      `/api/v3/repos/office/tools/commits/${first.headCommit}/check-runs`,
      `/api/v3/repos/office/tools/commits/${first.headCommit}/status`,
      "/api/v3/repos/office/tools/pulls",
    ]);

    github.pullRequests.setChecks("office/tools", 1, "pending");
    await expect(pullRequests.status(remoteUrl(), 1)).resolves.toMatchObject({
      checks: "pending",
    });
  });

  it("can't be read while signed out, saying so without throwing", async () => {
    await expect(pullRequests.whyCannotRead(remoteUrl())).resolves.toMatch(
      /no one is signed in\. Sign in with GitHub in Settings › Office identity\.$/,
    );
    await expect(pullRequests.openPullRequests(remoteUrl())).rejects.toThrow(NotSignedInWithGitHub);
    signIn();
    await expect(pullRequests.whyCannotRead(remoteUrl())).resolves.toBeUndefined();
    expect(pullRequests.reaches(remoteUrl())).toBe(true);
    expect(pullRequests.reaches("https://gitlab.com/office/tools.git")).toBe(false);
  });
});
