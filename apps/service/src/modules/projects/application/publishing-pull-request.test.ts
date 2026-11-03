import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandLineGit } from "../adapters/git/command-line-git.js";
import { serviceVariables } from "../adapters/git/command-line-git.fixtures.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  pullRequestText,
  type PullRequestsForTests,
} from "../adapters/git/publishing-testbed.fixtures.js";
import type { Publishing } from "./publishing.js";
import type { Worktrees } from "./worktrees.js";

let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let worktrees: Worktrees;
let pullRequests: PullRequestsForTests;
let publishing: Publishing;
let git: CommandLineGit;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository, worktrees, pullRequests, publishing, git } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing in push + PR mode", PUBLISHING_TEST, () => {
  it("pushes the Task's branch and opens a pull request into the base, in the record's words", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());

    const publication = await publishing.publish(
      testbed.pullRequestProject(),
      task.taskId,
      pullRequestText,
      "publishing-mode",
    );

    expect(publication).toEqual({
      kind: "pull-request-opened",
      branch: task.branch,
      url: "https://github.com/notnullsoft/admin/pull/1",
    });
    expect(testbed.originCommitOf(task.branch)).toBe(task.commit);
    expect(pullRequests.requests).toEqual([
      {
        remoteUrl: await testbed.originUrl(),
        baseBranch: "main",
        branch: task.branch,
        ...pullRequestText,
      },
    ]);
    expect(pullRequests.askedWhy).toEqual([await testbed.originUrl()]);
    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      gitIn(repository.path, "rev-parse", `${task.commit}^`),
    );
  });

  it("holds the repository from the fetch to the pull request, so no git change lands between", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    const other = await worktrees.open(testbed.pullRequestProject(), "task-meanwhile");
    await writeFile(join(other.path, "meanwhile.txt"), "meanwhile\n");
    let release!: () => void;
    pullRequests.held = new Promise((resolve) => (release = resolve));
    const log: string[] = [];

    const publishingDone = publishing
      .publish(testbed.pullRequestProject(), task.taskId, pullRequestText, "publishing-mode")
      .then(() => void log.push("published"));
    await expect.poll(() => pullRequests.requests.length, { timeout: 30_000 }).toBe(1);
    const committing = git
      .commit(other.path, "Add meanwhile.txt", serviceVariables)
      .then(() => void log.push("committed"));
    // Long enough for the commit to finish, were it not waiting.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(log).toEqual([]);
    release();
    await Promise.all([publishingDone, committing]);

    expect(log).toEqual(["published", "committed"]);
  });

  it("opens the pull request when the base moved on but the branch still merges cleanly", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    await expect(
      publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      ),
    ).resolves.toMatchObject({
      kind: "pull-request-opened",
    });
  });

  it("fails with GitHub's words when the pull request is refused, the branch pushed", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    pullRequests.refusal = "GitHub didn't open the pull request: GraphQL: Resource not accessible.";

    await expect(
      publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      ),
    ).resolves.toEqual({
      kind: "failed",
      error: "GitHub didn't open the pull request: GraphQL: Resource not accessible.",
    });
    expect(testbed.originCommitOf(task.branch)).toBe(task.commit);
  });

  it("fails with the remote's words when the push is rejected, opening no pull request", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    const hook = join(repository.originPath, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
    try {
      const publication = await publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      );

      expect(publication).toMatchObject({ kind: "failed" });
      expect(publication.kind === "failed" && publication.error).toMatch(
        new RegExp(
          `^Pushing ${task.branch} to ${task.branch} on origin failed\\. git said: .*protected branch`,
          "s",
        ),
      );
    } finally {
      await rm(hook);
    }
    expect(pullRequests.requests).toEqual([]);
  });

  it("asks nothing of the remote when the branch would conflict with the base", async () => {
    const file = `conflict-${testbed.taskCount + 1}.txt`;
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      ),
    ).resolves.toEqual({
      kind: "base-moved",
      error: `${task.branch} no longer applies cleanly on main on origin: it would conflict in\n- ${file}`,
      conflictedFiles: [file],
    });
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
    expect(pullRequests.requests).toEqual([]);
  });

  it("is refused before the push when no pull request can be opened, saying why", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    pullRequests.blocker = "No one is signed in with GitHub.";

    await expect(
      publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      ),
    ).resolves.toEqual({
      kind: "failed",
      error: `Push + PR didn't push ${task.branch} to origin: No one is signed in with GitHub. Then run Publish again, or change the Project's publishing mode to merge.`,
    });
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
    expect(pullRequests.requests).toEqual([]);
  });

  it("is refused before sending a conflicting branch to Resolve, which couldn't open one either", async () => {
    const file = `blocked-conflict-${testbed.taskCount + 1}.txt`;
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject(), file);
    await commitOnOrigin(repository, "main", file);
    pullRequests.blocker = "The remote isn't a repository on github.com.";

    await expect(
      publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        pullRequestText,
        "publishing-mode",
      ),
    ).resolves.toMatchObject({ kind: "failed" });
  });
});
