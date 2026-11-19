import { describe, expect, it } from "vitest";
import {
  GitHubAccessFailed,
  NotSignedInWithGitHub,
  PullRequestNotOpened,
  type GitHubPullRequests,
  type PullRequestOnRemote,
} from "../../../github/index.js";
import { CodeHostRefused } from "../../ports/code-host.js";
import { GitHubCodeHost } from "./github-code-host.js";

const REQUEST = {
  remoteUrl: "https://github.com/office/tools.git",
  baseBranch: "main",
  branch: "office/task-1",
  title: "Rename a device",
  body: "## Definition of Done",
};

const STATUS = {
  state: "open",
  checks: "passing",
  mergeable: "yes",
  headCommit: "a".repeat(40),
  baseCommit: "b".repeat(40),
} as const;

/** The github module's pull requests, answering each asked one, or failing as a test says. */
function gitHubAnswering(failure?: Error): {
  gitHub: GitHubPullRequests;
  asked: PullRequestOnRemote[];
} {
  const asked: PullRequestOnRemote[] = [];
  const answer = <Answer>(value: Answer): Promise<Answer> =>
    failure ? Promise.reject(failure) : Promise.resolve(value);
  const gitHub = {
    reaches: (remoteUrl: string) => remoteUrl.includes("github.com"),
    whyCannotOpen: (remoteUrl: string) =>
      Promise.resolve(remoteUrl.includes("github.com") ? undefined : "Not on GitHub."),
    open: (pullRequest: PullRequestOnRemote) => {
      asked.push(pullRequest);
      return answer({ number: 1, url: "https://github.com/office/tools/pull/1" });
    },
    status: () => answer(STATUS),
    openPullRequests: () => answer([]),
  } as unknown as GitHubPullRequests;
  return { gitHub, asked };
}

describe("GitHub as a code host", () => {
  it("opens the branch into the base on the remote it was pushed to", async () => {
    const { gitHub, asked } = gitHubAnswering();

    await expect(new GitHubCodeHost(gitHub).open(REQUEST)).resolves.toEqual({
      number: 1,
      url: "https://github.com/office/tools/pull/1",
    });
    expect(asked).toEqual([
      {
        remoteUrl: REQUEST.remoteUrl,
        base: "main",
        head: "office/task-1",
        title: REQUEST.title,
        body: REQUEST.body,
      },
    ]);
  });

  it("gives a pull request's status as the github module reads it", async () => {
    const { gitHub } = gitHubAnswering();

    await expect(
      new GitHubCodeHost(gitHub).pullRequestStatus(REQUEST.remoteUrl, 1),
    ).resolves.toEqual(STATUS);
  });

  it.each([
    new PullRequestNotOpened("GitHub didn't open the pull request."),
    new NotSignedInWithGitHub(),
    new GitHubAccessFailed("GitHub couldn't be reached."),
  ])("refuses in the github module's words when it fails: %s", async (failure) => {
    const { gitHub } = gitHubAnswering(failure);
    const host = new GitHubCodeHost(gitHub);

    await expect(host.open(REQUEST)).rejects.toThrow(new CodeHostRefused(failure.message));
    await expect(host.openPullRequests(REQUEST.remoteUrl)).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(host.pullRequestStatus(REQUEST.remoteUrl, 1)).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
  });

  it("reaches only GitHub's repositories and says why none can be opened elsewhere", async () => {
    const { gitHub } = gitHubAnswering();
    const host = new GitHubCodeHost(gitHub);

    expect(host.reaches("git@gitlab.com:office/tools.git")).toBe(false);
    await expect(host.whyCannotOpen("git@gitlab.com:office/tools.git")).resolves.toBe(
      "Not on GitHub.",
    );
  });
});
