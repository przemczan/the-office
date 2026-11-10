import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
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

    await expect(pullRequests.open(aPullRequest())).resolves.toBe(
      `${github.urls.web}/office/tools/pull/1`,
    );
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

    await expect(pullRequests.open(aPullRequest({ title: "Again" }))).resolves.toBe(
      `${github.urls.web}/office/tools/pull/1`,
    );
    expect(github.pullRequests.opened).toHaveLength(1);
    expect(github.requestsTo("/api/v3/repos/office/tools/pulls").at(-1)?.search).toBe(
      "?state=open&head=office%3Aoffice%2Ftask-1&base=main",
    );
  });
});
