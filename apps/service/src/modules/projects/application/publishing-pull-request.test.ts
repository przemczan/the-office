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
  commitMessage,
  type CodeHostForTests,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { PullRequestOpened } from "../domain/pull-request-events.js";
import type { Publishing } from "./publishing.js";

let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let pullRequests: CodeHostForTests;
let publishing: Publishing;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository, pullRequests, publishing } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
  testbed.records.kept.clear();
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing in push + PR mode", PUBLISHING_TEST, () => {
  it("pushes the Task's branch and opens a pull request into the base, titled and worded by the commit message", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());

    const publication = await publishing.publish(
      testbed.pullRequestProject(),
      task.taskId,
      commitMessage,
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
        title: commitMessage.subject,
        body: commitMessage.body,
      },
    ]);
    expect(pullRequests.askedWhy).toEqual([await testbed.originUrl()]);
    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      gitIn(repository.path, "rev-parse", `${task.commit}^`),
    );
  });

  it("records the pull request it opened for the Task and announces it", async () => {
    const project = testbed.pullRequestProject();
    const task = await testbed.aTaskWithACommit(project);
    testbed.published.length = 0;

    await publishing.publish(project, task.taskId, commitMessage, "publishing-mode");

    const [recorded, ...others] = await testbed.records.listOpen(project.id);
    expect(others).toEqual([]);
    expect(recorded).toMatchObject({
      projectId: project.id,
      taskId: task.taskId,
      remoteUrl: await testbed.originUrl(),
      number: 1,
      url: "https://github.com/notnullsoft/admin/pull/1",
      title: commitMessage.subject,
      branch: task.branch,
      baseBranch: "main",
      state: "open",
      checks: "unknown",
      mergeable: "unknown",
      checkedAt: null,
      endedAt: null,
      stale: false,
    });
    expect(testbed.published).toHaveLength(1);
    expect(testbed.published[0]).toBeInstanceOf(PullRequestOpened);
    expect(testbed.published[0]).toMatchObject({
      projectId: project.id,
      taskId: task.taskId,
      number: 1,
      url: "https://github.com/notnullsoft/admin/pull/1",
    });
  });

  it("fails with the remote's words when the push is rejected, opening no pull request", async () => {
    const task = await testbed.aTaskWithACommit(testbed.pullRequestProject());
    const hook = join(repository.originPath, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
    try {
      const publication = await publishing.publish(
        testbed.pullRequestProject(),
        task.taskId,
        commitMessage,
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
        commitMessage,
        "publishing-mode",
      ),
    ).resolves.toEqual({
      kind: "base-moved",
      error: `${task.branch} no longer applies cleanly on main on origin: it would conflict in\n- ${file}`,
      base: { remote: "origin", branch: "main" },
      conflictedFiles: [file],
    });
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
    expect(pullRequests.requests).toEqual([]);
  });
});
