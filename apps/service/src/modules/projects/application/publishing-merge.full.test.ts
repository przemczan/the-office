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
} from "../adapters/git/publishing-testbed.fixtures.js";
import type { Publishing } from "./publishing.js";
import type { Worktrees } from "./worktrees.js";

let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let worktrees: Worktrees;
let publishing: Publishing;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository, worktrees, publishing } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing in merge mode", PUBLISHING_TEST, () => {
  it("has nothing to publish when it runs again after merging", async () => {
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());
    await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      pullRequestText,
      "publishing-mode",
    );

    await expect(
      publishing.publish(testbed.mergingProject(), task.taskId, pullRequestText, "publishing-mode"),
    ).resolves.toEqual({
      kind: "nothing-to-publish",
      branch: task.branch,
      base: { remote: "origin", branch: "main" },
    });
  });

  it("rebases the branch onto a base that moved on, then moves the base to it", async () => {
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());
    const moved = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    const publication = await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      pullRequestText,
      "publishing-mode",
    );

    const rebased = gitIn(repository.path, "rev-parse", `refs/heads/${task.branch}`);
    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch: "main" },
      commit: rebased,
      baseTakenIn: "by-rebase",
    });
    expect(rebased).not.toBe(task.commit);
    expect(gitIn(repository.path, "rev-parse", `${rebased}^`)).toBe(moved);
    expect(testbed.originCommitOf("main")).toBe(rebased);
    const worktreePath = worktrees.pathOf(testbed.mergingProject(), task.taskId);
    expect(gitIn(worktreePath, "rev-parse", "HEAD")).toBe(rebased);
    expect(gitIn(worktreePath, "status", "--porcelain")).toBe("");
  });

  it("keeps what it shipped in the Task's changes after the base took the branch", async () => {
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());
    const forkedFrom = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      pullRequestText,
      "publishing-mode",
    );

    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      forkedFrom,
    );
    const changes = await worktrees.changes(testbed.mergingProject(), task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`${task.taskId}.txt`]);
  });
});
