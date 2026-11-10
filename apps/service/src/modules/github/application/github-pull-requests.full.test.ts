import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import { PullRequestNotOpened } from "../domain/pull-request.js";
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
  it("opens another into a different base", async () => {
    signIn();
    await pullRequests.open(aPullRequest());

    await expect(pullRequests.open(aPullRequest({ base: "release" }))).resolves.toBe(
      `${github.urls.web}/office/tools/pull/2`,
    );
  });

  it("refuses in GitHub's words when it has nothing to open", async () => {
    signIn();
    github.pullRequests.withoutCommits.add("office/task-1");

    await expect(pullRequests.open(aPullRequest())).rejects.toThrow(
      new PullRequestNotOpened(
        "GitHub didn't open the pull request of office/task-1 into main: No commits between main and office/task-1",
      ),
    );
  });

  it("says to install the App on a repository GitHub doesn't show", async () => {
    signIn();

    await expect(
      pullRequests.open(aPullRequest({ remoteUrl: `${github.urls.web}/office/other.git` })),
    ).rejects.toThrow(
      new PullRequestNotOpened(
        "GitHub doesn't show office/other to the signed-in user (HTTP 404). Install the GitHub App on it from Settings › Office identity.",
      ),
    );
  });

  it("refuses a remote that isn't on GitHub without asking GitHub", async () => {
    signIn();

    await expect(
      pullRequests.open(aPullRequest({ remoteUrl: "https://gitlab.com/office/tools.git" })),
    ).rejects.toThrow(PullRequestNotOpened);
    expect(github.requestsTo("/api/v3/repos")).toEqual([]);
  });

  it("needs the sign-in", async () => {
    await expect(pullRequests.open(aPullRequest())).rejects.toThrow(NotSignedInWithGitHub);
    expect(github.requestsTo("/api/v3/repos")).toEqual([]);
  });

  it("fails, keeping the sign-in, when GitHub can't be reached", async () => {
    signIn();
    const pullRequest = aPullRequest();
    await github.close();
    github = await FakeGitHub.start();

    await expect(pullRequests.open(pullRequest)).rejects.toThrow(GitHubAccessFailed);
    expect(signIns.signIn?.status).toBe("signed-in");
  });
});

describe("why no pull request can be opened", () => {
  it("is nothing while signed in and the remote is on GitHub, asking GitHub nothing", async () => {
    signIn();

    await expect(pullRequests.whyCannotOpen(aPullRequest().remoteUrl)).resolves.toBeUndefined();
    expect(github.requests).toEqual([]);
  });

  it("is the sign-in while signed out, naming where to sign in", async () => {
    await expect(pullRequests.whyCannotOpen(aPullRequest().remoteUrl)).resolves.toMatch(
      /no one is signed in\. Sign in with GitHub in Settings › Office identity\.$/,
    );
  });

  it("is a remote that isn't on GitHub", async () => {
    signIn();

    await expect(pullRequests.whyCannotOpen("git@gitlab.com:office/tools.git")).resolves.toBe(
      `The remote isn't a repository on ${new URL(github.urls.web).host}, and The Office opens pull requests on GitHub only.`,
    );
  });
});
