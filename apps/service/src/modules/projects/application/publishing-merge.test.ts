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
  type PullRequestsForTests,
} from "../adapters/git/publishing-testbed.fixtures.js";
import type { Publishing } from "./publishing.js";

let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let pullRequests: PullRequestsForTests;
let publishing: Publishing;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository, pullRequests, publishing } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing in merge mode", PUBLISHING_TEST, () => {
  it("lands the Task on the base on the remote as one commit with its message, leaving the user's checkout as it is", async () => {
    const localMain = gitIn(repository.path, "rev-parse", "main");
    const task = await testbed.aTaskWithACommit(testbed.mergingProject());

    const publication = await publishing.publish(
      testbed.mergingProject(),
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    const forkedFrom = gitIn(repository.path, "rev-parse", `${task.commit}^`);
    const landed = testbed.originCommitOf("main") ?? "";
    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch: "main" },
      commit: landed,
      subject: commitMessage.subject,
      head: task.commit,
      baseTakenIn: "not-needed",
    });
    expect(landed).not.toBe(task.commit);
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", landed)).toBe(
      `${landed} ${forkedFrom}`,
    );
    expect(gitIn(repository.path, "log", "--format=%B", "--max-count=1", landed)).toBe(
      commitMessage.whole,
    );
    expect(gitIn(repository.path, "rev-parse", `${landed}^{tree}`)).toBe(
      gitIn(repository.path, "rev-parse", `${task.commit}^{tree}`),
    );
    expect(gitIn(repository.path, "rev-parse", "refs/remotes/origin/main")).toBe(landed);
    // The Stage commits stay on the Task's branch alone.
    expect(gitIn(repository.path, "branch", "--remotes", "--contains", task.commit)).toBe("");
    expect(gitIn(repository.path, "rev-parse", "main")).toBe(localMain);
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");
    expect(pullRequests.requests).toEqual([]);
    expect(pullRequests.askedWhy).toEqual([]);
  });

  it("names the conflicting files when the branch would conflict with the base", async () => {
    const file = `conflict-${testbed.taskCount + 1}.txt`;
    const task = await testbed.aTaskWithACommit(testbed.mergingProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(testbed.mergingProject(), task.taskId, commitMessage, "publishing-mode"),
    ).resolves.toMatchObject({
      kind: "base-moved",
      conflictedFiles: [file],
    });
  });
});
