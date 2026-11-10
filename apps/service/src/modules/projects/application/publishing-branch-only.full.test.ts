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

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository, worktrees, pullRequests, publishing } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing the branch only", PUBLISHING_TEST, () => {
  it.each(["push-and-pull-request", "merge"] as const)(
    "pushes the Task's branch alone in %s mode, opening no pull request and leaving the base",
    async (publishingMode) => {
      const project = testbed.aProjectPublishingBy(publishingMode);
      const task = await testbed.aTaskWithACommit(project);
      const originMain = testbed.originCommitOf("main");

      const publication = await publishing.publish(
        project,
        task.taskId,
        pullRequestText,
        "branch-only",
      );

      expect(publication).toEqual({ kind: "branch-pushed", branch: task.branch, remote: "origin" });
      expect(testbed.originCommitOf(task.branch)).toBe(task.commit);
      expect(testbed.originCommitOf("main")).toBe(originMain);
      expect(pullRequests.requests).toEqual([]);
      expect(pullRequests.askedWhy).toEqual([]);
    },
  );

  it("pushes a branch the base moved past, as nothing is merged", async () => {
    const file = `conflict-${testbed.taskCount + 1}.txt`;
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(testbed.pullRequestProject(), task.taskId, pullRequestText, "branch-only"),
    ).resolves.toEqual({ kind: "branch-pushed", branch: task.branch, remote: "origin" });
    expect(testbed.originCommitOf(task.branch)).toBe(task.commit);
  });

  it("keeps what it pushed in the Task's changes once the worktree is gone", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());

    await publishing.publish(
      testbed.pullRequestProject(),
      task.taskId,
      pullRequestText,
      "branch-only",
    );
    await worktrees.remove(testbed.pullRequestProject(), task.taskId);

    const changes = await worktrees.changes(testbed.pullRequestProject(), task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`${task.taskId}.txt`]);
    expect(changes.worktreePath).toBeUndefined();
  });
});

describe("Publishing without a remote", PUBLISHING_TEST, () => {
  it("fails, saying the base branch tracks none", async () => {
    gitIn(repository.path, "branch", "--quiet", "--unset-upstream", "main");
    try {
      const project = testbed.aProjectPublishingBy("merge");
      const task = await testbed.aTaskWithACommit(project);

      await expect(
        publishing.publish(project, task.taskId, pullRequestText, "publishing-mode"),
      ).resolves.toEqual({
        kind: "failed",
        error:
          "main tracks no remote branch, so Publish has nowhere to push. Set its upstream (`git branch --set-upstream-to=origin/main main`), then run Publish again.",
      });
    } finally {
      gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
    }
  });
});
