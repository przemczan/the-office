import { describe, expect, it } from "vitest";
import { PullRequestRefused, type PullRequestRequest } from "../../ports/pull-requests.js";
import { pullRequestArguments, pullRequestOf } from "./github-cli-pull-requests.js";

const request: PullRequestRequest = {
  repositoryPath: "/projects/admin-panel",
  baseBranch: "main",
  branch: "office/task-1",
  title: "Rename a device --draft",
  body: "## Definition of Done\n\n- [x] The rename persists",
};

function ran(exitCode: number, stdout: string, stderr = "") {
  return { kind: "ran", exitCode, stdout, stderr } as const;
}

describe("pullRequestArguments", () => {
  it("opens a pull request of the pushed branch into the base, with the body on standard input", () => {
    expect(pullRequestArguments(request)).toEqual([
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      "office/task-1",
      // A title that looks like an option stays the flag's value.
      "--title",
      "Rename a device --draft",
      "--body-file",
      "-",
    ]);
  });
});

describe("pullRequestOf", () => {
  it("is the pull request gh printed", () => {
    expect(pullRequestOf(ran(0, "https://github.com/notnullsoft/admin/pull/42\n"))).toEqual({
      url: "https://github.com/notnullsoft/admin/pull/42",
    });
  });

  it("is the pull request already open for the branch, as Publish run again finds it", () => {
    const stderr =
      'a pull request for branch "office/task-1" into branch "main" already exists:\nhttps://github.com/notnullsoft/admin/pull/41\n';

    expect(pullRequestOf(ran(1, "", stderr))).toEqual({
      url: "https://github.com/notnullsoft/admin/pull/41",
    });
  });

  it("refuses in GitHub's words when it didn't open one", () => {
    const noCommits = ran(
      1,
      "",
      "pull request create failed: GraphQL: No commits between main and office/task-1",
    );

    expect(() => pullRequestOf(noCommits)).toThrow(PullRequestRefused);
    expect(() => pullRequestOf(noCommits)).toThrow(
      "GitHub didn't open the pull request: `gh pr create` failed with exit code 1. gh said: pull request create failed: GraphQL: No commits between main and office/task-1",
    );
  });

  it("says to sign in when gh isn't", () => {
    expect(() =>
      pullRequestOf(ran(4, "", "To get started with GitHub CLI, please run:  gh auth login")),
    ).toThrow(/isn't signed in to GitHub.*Sign in with `gh auth login`/);
  });

  it("says where to get gh when it isn't on PATH", () => {
    expect(() => pullRequestOf({ kind: "not-found" })).toThrow(
      /couldn't find GitHub's `gh` on PATH.*https:\/\/cli\.github\.com/,
    );
  });

  it("refuses a run that printed no pull request", () => {
    expect(() => pullRequestOf(ran(0, "Creating pull request…\n"))).toThrow(
      "GitHub didn't open the pull request: `gh pr create` printed no pull request.",
    );
  });
});
