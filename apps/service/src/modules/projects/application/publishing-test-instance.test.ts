import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import {
  CodeHostForTests,
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";
import { CodeHosts } from "./code-hosts.js";

// A test instance of The Office (`OFFICE_TEST_INSTANCE=true`) pushes nothing and opens no pull
// request, on the server, in the publishing layer where each happens (spec §6, "Test instances").

const REFUSED_PUSH = "A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't push.";

let testbed: PublishingTestbed;

beforeAll(async () => {
  testbed = await PublishingTestbed.create({ testInstance: true });
});

afterAll(async () => {
  await testbed.remove();
});

describe("Publishing in a test instance of The Office", PUBLISHING_TEST, () => {
  it("refuses to push a Task's branch, which the remote never gets", async () => {
    const project = testbed.pullRequestProject();
    const task = await testbed.aTaskWithACommit(project);

    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "branch-only",
    );

    expect(publication).toEqual({ kind: "failed", error: REFUSED_PUSH });
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
  });

  it("refuses Push + PR's push, so no pull request is asked for", async () => {
    const project = testbed.pullRequestProject();
    const task = await testbed.aTaskWithACommit(project);

    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(publication).toEqual({ kind: "failed", error: REFUSED_PUSH });
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
    expect(testbed.pullRequests.requests).toEqual([]);
  });

  it("refuses to push the commit a merge lands, leaving the remote's base as it was", async () => {
    const project = testbed.mergingProject();
    const before = testbed.originCommitOf("main");
    const task = await testbed.aTaskWithACommit(project);

    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(publication).toEqual({ kind: "failed", error: REFUSED_PUSH });
    expect(testbed.originCommitOf("main")).toBe(before);
  });

  it("refuses to push the commit a Task lands on its Initiative's branch, moving neither copy", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("test-instance", { pushed: true });
    const local = testbed.localCommitOf(branch);
    const onOrigin = testbed.originCommitOf(branch);
    const task = await testbed.aTaskWithACommit(project, "initiative-task.txt", branch);

    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(publication).toEqual({ kind: "failed", error: REFUSED_PUSH });
    expect(testbed.originCommitOf(branch)).toBe(onOrigin);
    expect(testbed.localCommitOf(branch)).toBe(local);
  });

  it("refuses to push a Publishing Task's branch after its Stage", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("test-instance-publishing");
    testbed.taskBases.publishingTasks.set("publishing-in-test-instance", branch);
    await testbed.worktrees.open(project, "publishing-in-test-instance");

    await expect(
      testbed.publishing.pushPublishingBranch(project, "publishing-in-test-instance"),
    ).resolves.toEqual({ kind: "failed", reason: REFUSED_PUSH });
    expect(testbed.originCommitOf(branch)).toBeUndefined();
  });
});

describe("Opening a pull request in a test instance of The Office", () => {
  it("is refused before the code host is asked", async () => {
    const host = new CodeHostForTests();
    const codeHosts = new CodeHosts([host], new OfficeTestInstance(true));

    const opening = codeHosts.open({
      remoteUrl: "https://github.com/notnullsoft/admin.git",
      baseBranch: "main",
      branch: "office/task-1",
      title: commitMessage.subject,
      body: commitMessage.body,
    });

    await expect(opening).rejects.toBeInstanceOf(TestInstanceRefused);
    await expect(opening).rejects.toThrow(
      "A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't open pull requests.",
    );
    expect(host.requests).toEqual([]);
  });
});
