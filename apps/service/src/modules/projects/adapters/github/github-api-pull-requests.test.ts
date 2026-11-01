import { describe, expect, it } from "vitest";
import {
  GitHubAccessFailed,
  NotSignedInWithGitHub,
  PullRequestNotOpened,
  type GitHubPullRequests,
  type PullRequestOnRemote,
} from "../../../github/index.js";
import { PullRequestRefused } from "../../ports/pull-requests.js";
import { GitHubApiPullRequests } from "./github-api-pull-requests.js";

const REQUEST = {
  remoteUrl: "https://github.com/office/tools.git",
  baseBranch: "main",
  branch: "office/task-1",
  title: "Rename a device",
  body: "## Definition of Done",
};

/** The github module's pull requests, opening each asked one, or failing as a test says. */
function gitHubOpening(failure?: Error): {
  gitHub: GitHubPullRequests;
  asked: PullRequestOnRemote[];
} {
  const asked: PullRequestOnRemote[] = [];
  const gitHub = {
    whyCannotOpen: (remoteUrl: string) =>
      Promise.resolve(remoteUrl.includes("github.com") ? undefined : "Not on GitHub."),
    open: (pullRequest: PullRequestOnRemote) => {
      asked.push(pullRequest);
      return failure
        ? Promise.reject(failure)
        : Promise.resolve("https://github.com/office/tools/pull/1");
    },
  } as unknown as GitHubPullRequests;
  return { gitHub, asked };
}

describe("pull requests through the github module", () => {
  it("opens the branch into the base on the remote it was pushed to", async () => {
    const { gitHub, asked } = gitHubOpening();

    await expect(new GitHubApiPullRequests(gitHub).open(REQUEST)).resolves.toEqual({
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

  it.each([
    new PullRequestNotOpened("GitHub didn't open the pull request."),
    new NotSignedInWithGitHub(),
    new GitHubAccessFailed("GitHub couldn't be reached."),
  ])("refuses in the github module's words when it fails: %s", async (failure) => {
    const { gitHub } = gitHubOpening(failure);

    await expect(new GitHubApiPullRequests(gitHub).open(REQUEST)).rejects.toThrow(
      new PullRequestRefused(failure.message),
    );
  });

  it("says why none can be opened, as the github module does", async () => {
    const { gitHub } = gitHubOpening();

    await expect(
      new GitHubApiPullRequests(gitHub).whyCannotOpen("git@gitlab.com:office/tools.git"),
    ).resolves.toBe("Not on GitHub.");
  });
});
