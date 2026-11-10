import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
});
