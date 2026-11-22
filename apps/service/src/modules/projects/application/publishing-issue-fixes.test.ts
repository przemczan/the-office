import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serviceVariables } from "../adapters/git/command-line-git.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { gitIn } from "../adapters/git/temporary-repository.fixtures.js";
import { DEFAULT_ISSUE_SETTINGS } from "../domain/issue-settings.js";
import type { Project } from "../domain/project.js";

// "Close the issue when the Task is Done" (docs/design/issues-as-tasks.html): what Publish lands
// carries `Fixes #n` for the Task's issue, on real git.
let testbed: PublishingTestbed;
let initiativeTasks: Map<string, readonly string[]>;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  initiativeTasks = new Map();
  testbed.issueTasks.register(
    () => Promise.reject(new Error("Publish makes no Task.")),
    (taskId) => Promise.resolve(initiativeTasks.get(taskId) ?? []),
  );
});

beforeEach(() => {
  testbed.pullRequests.reset();
  testbed.issueLinks.links.clear();
});

afterAll(async () => {
  await testbed.remove();
});

/** The Task `taskId` was imported from issue `number` of the origin, or of `remoteUrl`. */
async function linked(
  project: Project,
  taskId: string,
  number: number,
  remoteUrl?: string,
): Promise<void> {
  await testbed.issueLinks.claim({
    id: randomUUID(),
    projectId: project.id,
    remoteUrl: remoteUrl ?? (await testbed.originUrl()),
    number,
    taskId,
    title: `Issue ${number}`,
    url: `https://github.com/notnullsoft/admin/issues/${number}`,
    author: { login: "octocat", url: "https://github.com/octocat" },
    importedAt: new Date(),
    importedBy: { kind: "office" },
    closedOnHostAt: null,
    taskEndedAt: null,
    checkedAt: null,
  });
}

function messageOnOrigin(branch: string): string {
  return gitIn(testbed.repository.originPath, "log", "-1", "--format=%B", branch);
}

describe("Fixes #n in what Publish lands", PUBLISHING_TEST, () => {
  it("goes in the pull request's body on Push + PR, only for the issue of the same repository", async () => {
    const project = testbed.pullRequestProject();
    const task = await testbed.aTaskWithACommit(project);
    await linked(project, task.taskId, 7);
    const elsewhere = await testbed.aTaskWithACommit(project);
    await linked(project, elsewhere.taskId, 8, "https://github.com/someone/else.git");

    await testbed.publishing.publish(project, task.taskId, commitMessage, "publishing-mode");
    await testbed.publishing.publish(project, elsewhere.taskId, commitMessage, "publishing-mode");

    expect(testbed.pullRequests.requests.map(({ body }) => body)).toEqual([
      `${commitMessage.body}\n\nFixes #7`,
      commitMessage.body,
    ]);
  });

  it("goes in the commit a merge lands, which is kept for the Done comment", async () => {
    const project = testbed.mergingProject();
    const task = await testbed.aTaskWithACommit(project);
    await linked(project, task.taskId, 9);

    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(messageOnOrigin("main")).toBe(`${commitMessage.whole}\n\nFixes #9`);
    expect(publication.kind === "merged" && publication.commit).toBe(
      testbed.originCommitOf("main"),
    );
    await expect(testbed.worktrees.landedOf(project, task.taskId)).resolves.toBe(
      testbed.originCommitOf("main"),
    );
  });

  it("goes in each Task's merge into its Initiative's branch", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch(`fixes-${randomUUID().slice(0, 8)}`);
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    await linked(project, task.taskId, 10);

    await testbed.publishing.publish(project, task.taskId, commitMessage, "publishing-mode");

    expect(gitIn(testbed.repository.path, "log", "-1", "--format=%B", branch)).toBe(
      `${commitMessage.whole}\n\nFixes #10`,
    );
  });

  it("is never there twice, and not at all with the switch off", async () => {
    const project = testbed.pullRequestProject();
    const named = await testbed.aTaskWithACommit(project);
    await linked(project, named.taskId, 11);
    const off = await testbed.aTaskWithACommit(project);
    await linked(project, off.taskId, 12);
    const alreadyFixing = {
      ...commitMessage,
      body: `${commitMessage.body}\n\nFixes #11`,
      whole: `${commitMessage.whole}\n\nFixes #11`,
    };

    await testbed.publishing.publish(project, named.taskId, alreadyFixing, "publishing-mode");
    await testbed.publishing.publish(
      { ...project, issueSettings: { ...DEFAULT_ISSUE_SETTINGS, closeOnDone: false } },
      off.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(testbed.pullRequests.requests.map(({ body }) => body)).toEqual([
      alreadyFixing.body,
      commitMessage.body,
    ]);
  });

  it("is not there with the Project's GitHub issues switched off, the switch on", async () => {
    const project = testbed.pullRequestProject();
    const task = await testbed.aTaskWithACommit(project);
    await linked(project, task.taskId, 13);

    await testbed.publishing.publish(
      {
        ...project,
        issueSettings: { ...DEFAULT_ISSUE_SETTINGS, closeOnDone: true },
        features: { "github-issues": false },
      },
      task.taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(testbed.pullRequests.requests.map(({ body }) => body)).toEqual([commitMessage.body]);
  });

  it("names the Initiative's Tasks' issues on the Publishing Task's pull request", async () => {
    const project = testbed.pullRequestProject();
    const branch = testbed.anInitiativeBranch(`publishing-${randomUUID().slice(0, 8)}`);
    const publishingTask = "publishing-fixes";
    testbed.taskBases.publishingTasks.set(publishingTask, branch);
    const worktree = await testbed.worktrees.open(project, publishingTask);
    await writeFile(join(worktree.path, "initiative.txt"), "from the Initiative\n");
    await testbed.git.commit(worktree.path, "Add initiative.txt", serviceVariables);
    initiativeTasks.set(publishingTask, ["first-of-initiative", "second-of-initiative"]);
    await linked(project, "first-of-initiative", 21);
    await linked(project, "second-of-initiative", 20);

    await testbed.publishing.publish(project, publishingTask, commitMessage, "publishing-mode");

    expect(testbed.pullRequests.requests).toEqual([
      expect.objectContaining({
        branch,
        body: `${commitMessage.body}\n\nFixes #20\nFixes #21`,
      }),
    ]);
  });
});
