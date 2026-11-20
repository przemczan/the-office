import { describe, expect, it } from "vitest";
import {
  GitHubAccessFailed,
  NotSignedInWithGitHub,
  PullRequestChangedOnGitHub,
  PullRequestNotChanged,
  PullRequestNotOpened,
  type GitHubPullRequests,
  type MergeOnGitHub,
  type PullRequestOnRemote,
  type WorkflowStartOnGitHub,
} from "../../../github/index.js";
import { CodeHostChangedSince, CodeHostRefused } from "../../ports/code-host.js";
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

const RUN = {
  id: 9001,
  number: 12,
  attempt: 1,
  workflow: "CI",
  title: "Rename a device",
  trigger: "push",
  branch: "main",
  commit: "c".repeat(40),
  status: "failed",
  startedAt: new Date("2026-11-19T09:00:00.000Z"),
  updatedAt: new Date("2026-11-19T09:05:00.000Z"),
  url: "https://github.com/office/tools/actions/runs/9001",
} as const;

const WORKFLOW = {
  file: "release.yml",
  name: "Release",
  url: "https://github.com/office/tools/actions/workflows/release.yml",
  inputs: [
    {
      name: "channel",
      description: "",
      required: true,
      default: null,
      type: "choice",
      options: ["beta", "stable"],
    },
    {
      name: "dry-run",
      description: "Only pack it.",
      required: false,
      default: "false",
      type: "boolean",
      options: [],
    },
    { name: "notes", description: "", required: false, default: null, type: "string", options: [] },
  ],
} as const;

/** The github module's pull requests, answering each asked one, or failing as a test says. */
function gitHubAnswering(failure?: Error): {
  gitHub: GitHubPullRequests;
  asked: PullRequestOnRemote[];
  reruns: [string, number, boolean][];
  started: [string, WorkflowStartOnGitHub][];
  merged: { remoteUrl: string; number: number; merge: MergeOnGitHub }[];
} {
  const asked: PullRequestOnRemote[] = [];
  const reruns: [string, number, boolean][] = [];
  const started: [string, WorkflowStartOnGitHub][] = [];
  const merged: { remoteUrl: string; number: number; merge: MergeOnGitHub }[] = [];
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
    recentRuns: () => answer([RUN]),
    rerun: (remoteUrl: string, runId: number, onlyFailed: boolean) => {
      reruns.push([remoteUrl, runId, onlyFailed]);
      return answer(undefined);
    },
    manualWorkflows: () => answer([WORKFLOW]),
    refs: () => answer({ branches: ["main"], tags: ["v1.2.0"] }),
    startWorkflow: (remoteUrl: string, start: WorkflowStartOnGitHub) => {
      started.push([remoteUrl, start]);
      return answer(undefined);
    },
    mergeMethods: () => answer({ allowed: ["squash"], deletesBranchOnMerge: false }),
    merge: (remoteUrl: string, number: number, merge: MergeOnGitHub) => {
      merged.push({ remoteUrl, number, merge });
      return answer({ commit: "c".repeat(40) });
    },
    close: () => answer(undefined),
  } as unknown as GitHubPullRequests;
  return { gitHub, asked, reruns, started, merged };
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

  it("lists the recent CI runs and re-runs one with all its jobs or only the failed ones", async () => {
    const { gitHub, reruns } = gitHubAnswering();
    const host = new GitHubCodeHost(gitHub);

    await expect(host.recentRuns(REQUEST.remoteUrl, 30)).resolves.toEqual([RUN]);
    await host.rerun(REQUEST.remoteUrl, RUN.id, "all");
    await host.rerun(REQUEST.remoteUrl, RUN.id, "failed");

    expect(reruns).toEqual([
      [REQUEST.remoteUrl, RUN.id, false],
      [REQUEST.remoteUrl, RUN.id, true],
    ]);
  });

  it("lists the workflows started by hand with their inputs' kinds, the refs, and starts one", async () => {
    const { gitHub, started } = gitHubAnswering();
    const host = new GitHubCodeHost(gitHub);
    const inputs = { channel: "beta", "dry-run": "false" };

    await expect(host.manualWorkflows(REQUEST.remoteUrl, "main")).resolves.toEqual([
      {
        id: "release.yml",
        name: "Release",
        url: WORKFLOW.url,
        inputs: [
          expect.objectContaining({ name: "channel", kind: "choice", options: ["beta", "stable"] }),
          expect.objectContaining({ name: "dry-run", kind: "yes-no", default: "false" }),
          expect.objectContaining({ name: "notes", kind: "text", default: null }),
        ],
      },
    ]);
    await expect(host.refs(REQUEST.remoteUrl)).resolves.toEqual({
      branches: ["main"],
      tags: ["v1.2.0"],
    });
    await host.startWorkflow(REQUEST.remoteUrl, {
      workflowId: "release.yml",
      ref: "v1.2.0",
      inputs,
    });

    expect(started).toEqual([[REQUEST.remoteUrl, { file: "release.yml", ref: "v1.2.0", inputs }]]);
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
    await expect(host.recentRuns(REQUEST.remoteUrl, 30)).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(host.rerun(REQUEST.remoteUrl, RUN.id, "failed")).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(host.manualWorkflows(REQUEST.remoteUrl, "main")).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(host.refs(REQUEST.remoteUrl)).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(
      host.startWorkflow(REQUEST.remoteUrl, { workflowId: "release.yml", ref: "main", inputs: {} }),
    ).rejects.toThrow(new CodeHostRefused(failure.message));
  });

  it("merges, closes and gives the merge methods as the github module does", async () => {
    const { gitHub, merged } = gitHubAnswering();
    const host = new GitHubCodeHost(gitHub);
    const merge = { method: "squash", expectedHeadCommit: "a".repeat(40) } as const;

    await expect(host.mergeMethods(REQUEST.remoteUrl, 1)).resolves.toEqual({
      allowed: ["squash"],
      deletesBranchOnMerge: false,
    });
    await expect(host.merge(REQUEST.remoteUrl, 1, merge)).resolves.toEqual({
      commit: "c".repeat(40),
    });
    expect(merged).toEqual([{ remoteUrl: REQUEST.remoteUrl, number: 1, merge }]);
    await expect(host.close(REQUEST.remoteUrl, 1)).resolves.toBeUndefined();
  });

  it("refuses a merge or close in the github module's words", async () => {
    const failure = new PullRequestNotChanged(
      "GitHub won't merge #1: Pull Request is not mergeable",
    );
    const host = new GitHubCodeHost(gitHubAnswering(failure).gitHub);
    const merge = { method: "merge", expectedHeadCommit: "a".repeat(40) } as const;

    const merging = host.merge(REQUEST.remoteUrl, 1, merge);
    await expect(merging).rejects.toThrow(new CodeHostRefused(failure.message));
    await expect(merging).rejects.not.toBeInstanceOf(CodeHostChangedSince);
    await expect(host.close(REQUEST.remoteUrl, 1)).rejects.toThrow(
      new CodeHostRefused(failure.message),
    );
    await expect(host.mergeMethods(REQUEST.remoteUrl, 1)).rejects.toThrow(CodeHostRefused);
  });

  it("refuses a merge of a pull request changed since as changed, to offer Refresh", async () => {
    const failure = new PullRequestChangedOnGitHub(1);
    const host = new GitHubCodeHost(gitHubAnswering(failure).gitHub);

    const merging = host.merge(REQUEST.remoteUrl, 1, {
      method: "merge",
      expectedHeadCommit: "a".repeat(40),
    });
    await expect(merging).rejects.toBeInstanceOf(CodeHostChangedSince);
    await expect(merging).rejects.toThrow(failure.message);
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
