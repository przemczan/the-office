import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GitHubRestApi } from "../adapters/github/github-rest-api.js";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import { FakeGitHub } from "../index.fixtures.js";
import { GitHubAppForTests } from "../ports/github-app-repository.fixtures.js";
import { GitHubSignInForTests } from "../ports/github-sign-in-repository.fixtures.js";
import { GitHubAccess } from "./github-access.js";
import { GitHubIssues } from "./github-issues.js";
import { SignInChanges } from "./sign-in-changes.js";

let github: FakeGitHub;
let signIns: GitHubSignInForTests;
let issues: GitHubIssues;

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
  issues = new GitHubIssues(api, access, github.urls);
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

function remoteUrl(): string {
  return `${github.urls.web}/office/tools.git`;
}

describe("listing a repository's open issues on GitHub", () => {
  it("lists the open issues, leaving out the pull requests GitHub lists among them", async () => {
    signIn();
    github.issues.addIssue("office/tools", {
      number: 1,
      title: "Live view freezes",
      body: "After the laptop wakes up.",
      labels: ["Bug", "live-view"],
      author: "octocat",
    });
    github.issues.addIssue("office/tools", { number: 2, pullRequest: true });
    github.issues.addIssue("office/tools", { number: 3, state: "closed" });
    github.issues.addIssue("office/tools", { number: 4 });

    const listed = await issues.openIssues(remoteUrl(), { order: "newest-first", most: 500 });

    expect(listed.map(({ number }) => number)).toEqual([4, 1]);
    expect(listed[1]).toEqual({
      number: 1,
      title: "Live view freezes",
      body: "After the laptop wakes up.",
      url: `${github.urls.web}/office/tools/issues/1`,
      author: { login: "octocat", url: `${github.urls.web}/octocat` },
      labels: ["Bug", "live-view"],
      openedAt: new Date("2026-01-05T09:01:00.000Z"),
    });
    expect(listed[0]?.body).toBe("");
  });

  it("lists only those with a label, in any case, oldest first, every page up to the most", async () => {
    signIn();
    for (let number = 1; number <= 260; number += 1) {
      github.issues.addIssue("office/tools", {
        number,
        labels: number % 2 === 0 ? ["Office"] : [],
        pullRequest: number % 10 === 0,
      });
    }

    const listed = await issues.openIssues(remoteUrl(), {
      label: "office",
      order: "oldest-first",
      most: 50,
    });

    expect(listed).toHaveLength(50);
    expect(listed[0]?.number).toBe(2);
    expect(listed.every(({ number }) => number % 2 === 0 && number % 10 !== 0)).toBe(true);
    expect(github.requestsTo("/api/v3/repos/office/tools/issues")[0]?.search).toContain(
      "labels=office",
    );
  });

  it("can't be listed while signed out", async () => {
    await expect(
      issues.openIssues(remoteUrl(), { order: "newest-first", most: 10 }),
    ).rejects.toBeInstanceOf(NotSignedInWithGitHub);
  });

  it("refuses a remote that isn't on GitHub", async () => {
    signIn();
    await expect(
      issues.openIssues("https://gitlab.example/office/tools.git", {
        order: "newest-first",
        most: 10,
      }),
    ).rejects.toBeInstanceOf(GitHubAccessFailed);
  });
});

describe("reading one issue on GitHub", () => {
  it("gives where it stands, open or closed and when", async () => {
    signIn();
    github.issues.addIssue("office/tools", { number: 7 });
    github.issues.addIssue("office/tools", {
      number: 8,
      state: "closed",
      closedAt: "2026-02-01T10:00:00Z",
    });

    await expect(issues.issue(remoteUrl(), 7)).resolves.toMatchObject({
      number: 7,
      state: { state: "open" },
    });
    await expect(issues.issue(remoteUrl(), 8)).resolves.toMatchObject({
      state: { state: "closed", closedAt: new Date("2026-02-01T10:00:00Z") },
    });
  });

  it("finds no issue for a number GitHub doesn't have, or a pull request's", async () => {
    signIn();
    github.issues.addIssue("office/tools", { number: 9, pullRequest: true });

    await expect(issues.issue(remoteUrl(), 9)).resolves.toBeUndefined();
    await expect(issues.issue(remoteUrl(), 99)).resolves.toBeUndefined();
  });
});

describe("writing on an issue on GitHub", () => {
  it("comments, and closes as not planned, with the App's Issues permission", async () => {
    signIn();
    github.installations.grant("office", { issues: "write" });
    github.issues.addIssue("office/tools", { number: 5 });

    await issues.comment(remoteUrl(), 5, "Closed: won't fix.");
    await issues.close(remoteUrl(), 5, "not_planned");

    expect(github.issues.comments).toEqual([
      { repository: "office/tools", number: 5, body: "Closed: won't fix." },
    ]);
    expect(github.issues.closes).toEqual([
      { repository: "office/tools", number: 5, reason: "not_planned" },
    ]);
    await expect(issues.issue(remoteUrl(), 5)).resolves.toMatchObject({
      state: { state: "closed" },
    });
  });

  it("opens a closed issue again", async () => {
    signIn();
    github.installations.grant("office", { issues: "write" });
    github.issues.addIssue("office/tools", { number: 6, state: "closed" });

    await issues.reopen(remoteUrl(), 6);

    await expect(issues.issue(remoteUrl(), 6)).resolves.toMatchObject({
      state: { state: "open" },
    });
  });

  it("refuses in GitHub's words without the App's Issues permission", async () => {
    signIn();
    github.issues.addIssue("office/tools", { number: 5 });

    await expect(issues.comment(remoteUrl(), 5, "Started.")).rejects.toThrow(
      new GitHubAccessFailed(
        "GitHub refused to comment on #5 of office/tools (HTTP 403): Resource not accessible by integration",
      ),
    );
    await expect(issues.close(remoteUrl(), 5, "completed")).rejects.toBeInstanceOf(
      GitHubAccessFailed,
    );
  });
});
