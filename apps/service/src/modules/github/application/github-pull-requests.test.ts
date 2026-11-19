import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import { PullRequestChangedOnGitHub, PullRequestNotChanged } from "../domain/merge-refusal.js";
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

  it("offers every merge method when GitHub leaves out the repository's settings", async () => {
    signIn();

    await expect(pullRequests.mergeMethods(remoteUrl())).resolves.toEqual({
      allowed: ["merge", "squash", "rebase"],
      deletesBranchOnMerge: undefined,
    });

    github.pullRequests.setRepository("office/tools", {
      allowMergeCommit: false,
      allowSquashMerge: true,
      allowRebaseMerge: true,
      deleteBranchOnMerge: true,
    });
    await expect(pullRequests.mergeMethods(remoteUrl())).resolves.toEqual({
      allowed: ["squash", "rebase"],
      deletesBranchOnMerge: true,
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

describe("GitHub Actions runs", () => {
  const RUNS = "/api/v3/repos/office/tools/actions/runs";

  it("lists the newest runs in host-neutral words", async () => {
    signIn();
    github.runs.addRun("office/tools", { id: 11, name: "CI", displayTitle: "Rename a device" });
    github.runs.addRun("office/tools", {
      id: 12,
      name: "Deploy",
      event: "pull_request",
      status: "in_progress",
      conclusion: null,
      headBranch: "office/task-1",
      headSha: "abc",
      runNumber: 7,
      startedAt: null,
      updatedAt: "2026-02-01T10:00:00Z",
    });

    const runs = await pullRequests.recentRuns(remoteUrl(), 5);

    expect(runs.map((run) => run.id)).toEqual([12, 11]);
    expect(runs[0]).toEqual({
      id: 12,
      number: 7,
      attempt: 1,
      workflow: "Deploy",
      title: "Deploy",
      trigger: "pull_request",
      branch: "office/task-1",
      commit: "abc",
      status: "running",
      startedAt: null,
      updatedAt: new Date("2026-02-01T10:00:00Z"),
      url: `${github.urls.web}/office/tools/actions/runs/12`,
    });
    expect(runs[1]).toMatchObject({ status: "succeeded", title: "Rename a device" });
    expect(github.requestsTo(RUNS).at(-1)?.search).toBe("?per_page=5");
  });

  it("reuses the runs GitHub says haven't changed", async () => {
    signIn();
    github.runs.addRun("office/tools", { id: 11 });
    const first = await pullRequests.recentRuns(remoteUrl(), 30);

    await expect(pullRequests.recentRuns(remoteUrl(), 30)).resolves.toEqual(first);
    expect(github.notModified.map((request) => request.path)).toEqual([RUNS]);
  });

  it("runs one again, and asks GitHub fresh for the runs after", async () => {
    signIn();
    github.installations.grant("office", { actions: "write" });
    github.runs.addRun("office/tools", { id: 11, conclusion: "failure" });
    await expect(pullRequests.recentRuns(remoteUrl(), 30)).resolves.toMatchObject([
      { status: "failed", attempt: 1 },
    ]);

    await pullRequests.rerun(remoteUrl(), 11, false);

    await expect(pullRequests.recentRuns(remoteUrl(), 30)).resolves.toMatchObject([
      { status: "queued", attempt: 2 },
    ]);
    expect(github.notModified).toEqual([]);
    expect(github.requestsTo(`${RUNS}/11/rerun`)).toHaveLength(1);
  });

  it("runs only the failed jobs again when asked", async () => {
    signIn();
    github.installations.grant("office", { actions: "write" });
    github.runs.addRun("office/tools", { id: 11, conclusion: "failure" });

    await pullRequests.rerun(remoteUrl(), 11, true);

    expect(github.requestsTo(`${RUNS}/11/rerun-failed-jobs`)).toHaveLength(1);
  });

  it("refuses a re-run GitHub refuses, in GitHub's words", async () => {
    signIn();
    github.runs.addRun("office/tools", { id: 11, conclusion: "failure" });

    const refusal = await pullRequests
      .rerun(remoteUrl(), 11, false)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GitHubAccessFailed);
    expect((refusal as GitHubAccessFailed).reason).toBe(
      "GitHub refused to re-run run 11 of office/tools (HTTP 403): Resource not accessible by integration",
    );
  });

  it("refuses reading the runs of a repository GitHub hides", async () => {
    signIn();

    await expect(pullRequests.recentRuns(`${github.urls.web}/other/repo.git`, 5)).rejects.toThrow(
      GitHubAccessFailed,
    );
  });

  it("can't be read or re-run while signed out", async () => {
    await expect(pullRequests.recentRuns(remoteUrl(), 5)).rejects.toThrow(NotSignedInWithGitHub);
    await expect(pullRequests.rerun(remoteUrl(), 1, false)).rejects.toThrow(NotSignedInWithGitHub);
  });
});

/** Pull request #1 opened while signed in; its head commit. */
async function openedHead(): Promise<string> {
  signIn();
  await pullRequests.open(aPullRequest());
  return github.pullRequests.opened[0]?.headSha ?? "";
}

describe("merging and closing a pull request on GitHub", () => {
  it("merges by the method asked, sending the head commit it last read", async () => {
    const head = await openedHead();

    const merged = await pullRequests.merge(remoteUrl(), 1, {
      method: "rebase",
      expectedHeadCommit: head,
    });

    expect(github.pullRequests.merges).toEqual([
      expect.objectContaining({
        number: 1,
        method: "rebase",
        sha: head,
        commitTitle: undefined,
        commitMessage: undefined,
      }),
    ]);
    expect(merged).toEqual({ commit: github.pullRequests.merges[0]?.commit });
    expect(github.pullRequests.opened[0]?.mergedAt).not.toBeNull();
  });

  it("squashes into a commit titled by the pull request's number, its body the message", async () => {
    const head = await openedHead();

    await pullRequests.merge(remoteUrl(), 1, { method: "squash", expectedHeadCommit: head });

    expect(github.pullRequests.merges).toEqual([
      expect.objectContaining({
        method: "squash",
        sha: head,
        commitTitle: "Rename a device (#1)",
        commitMessage: "## Definition of Done\n\n- [x] The rename persists",
      }),
    ]);
  });

  it("says GitHub won't merge, in its words, a method the repository doesn't allow", async () => {
    const head = await openedHead();
    github.pullRequests.setRepository("office/tools", { allowRebaseMerge: false });

    await expect(
      pullRequests.merge(remoteUrl(), 1, { method: "rebase", expectedHeadCommit: head }),
    ).rejects.toThrow(
      new PullRequestNotChanged(
        "GitHub won't merge #1: Rebase merges are not allowed on this repository.",
      ),
    );
  });

  it("says to refresh when the head moved since The Office read it", async () => {
    const head = await openedHead();
    github.pullRequests.pushHead("office/tools", 1);

    const merging = pullRequests.merge(remoteUrl(), 1, {
      method: "merge",
      expectedHeadCommit: head,
    });

    await expect(merging).rejects.toThrow(PullRequestChangedOnGitHub);
    await expect(merging).rejects.toThrow(
      "#1 changed on GitHub since The Office last read it. Refresh, then try again.",
    );
    expect(github.pullRequests.merges).toEqual([]);
  });

  it("says the account can't merge when GitHub forbids it", async () => {
    const head = await openedHead();
    github.pullRequests.refuseMerge(
      "office/tools",
      1,
      403,
      "Resource not accessible by integration",
    );

    await expect(
      pullRequests.merge(remoteUrl(), 1, { method: "merge", expectedHeadCommit: head }),
    ).rejects.toThrow(
      new PullRequestNotChanged("Your GitHub account can't merge in office/tools."),
    );
  });

  it("closes it without merging", async () => {
    await openedHead();

    await pullRequests.close(remoteUrl(), 1);

    expect(github.pullRequests.opened[0]).toMatchObject({ state: "closed", mergedAt: null });
    expect(github.requestsTo("/api/v3/repos/office/tools/pulls/1").at(-1)?.method).toBe("PATCH");
  });
});
