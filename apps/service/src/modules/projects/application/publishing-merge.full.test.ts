import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
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
      commitMessage,
      "publishing-mode",
    );

    await expect(
      publishing.publish(testbed.mergingProject(), task.taskId, commitMessage, "publishing-mode"),
    ).resolves.toEqual({
      kind: "nothing-to-publish",
      branch: task.branch,
      base: { remote: "origin", branch: "main" },
    });
  });

  it("takes a base that moved on into the branch by one merge commit, then lands one commit on it", async () => {
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());
    const moved = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    const publication = await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    const head = gitIn(repository.path, "rev-parse", `refs/heads/${task.branch}`);
    const landed = testbed.originCommitOf("main") ?? "";
    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch: "main" },
      commit: landed,
      subject: commitMessage.subject,
      head,
      baseTakenIn: "by-merge",
    });
    // The base came into the Task's branch by a merge, never a rebase: the Task's commit stays.
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", head)).toBe(
      `${head} ${task.commit} ${moved}`,
    );
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", landed)).toBe(
      `${landed} ${moved}`,
    );
    expect(gitIn(repository.path, "rev-list", "--count", `${moved}..${landed}`)).toBe("1");
    expect(gitIn(repository.path, "log", "--format=%B", "--max-count=1", landed)).toBe(
      commitMessage.whole,
    );
    const worktreePath = worktrees.pathOf(testbed.mergingProject(), task.taskId);
    expect(gitIn(worktreePath, "rev-parse", "HEAD")).toBe(head);
    expect(gitIn(worktreePath, "status", "--porcelain")).toBe("");
  });

  it("keeps what it shipped in the Task's changes after the base took the branch", async () => {
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());
    const forkedFrom = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      forkedFrom,
    );
    const changes = await worktrees.changes(testbed.mergingProject(), task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`${task.taskId}.txt`]);
  });
});
