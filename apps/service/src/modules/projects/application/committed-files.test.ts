import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { gitIn } from "../adapters/git/temporary-repository.fixtures.js";
import type { Project } from "../domain/project.js";
import { CommittedFiles } from "./committed-files.js";
import type { ProjectService } from "./project-service.js";
import type { RepositoryFiles } from "./repository-files.js";

// A Task's branch as committed, on real git: a repository whose main tracks a bare origin.
let testbed: PublishingTestbed;
let project: Project;
let files: CommittedFiles;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  project = testbed.mergingProject();
  files = new CommittedFiles(
    { read: () => Promise.resolve(project) } as unknown as ProjectService,
    testbed.git,
    testbed.worktrees,
    {} as RepositoryFiles,
  );
});

afterAll(async () => {
  await testbed.remove();
});

describe("CommittedFiles.taskBranchTip", PUBLISHING_TEST, () => {
  it("reads the Task's branch, then the tip kept when the branch was deleted", async () => {
    const task = await testbed.aTaskWithACommit(project);
    await expect(files.taskBranchTip(project.id, task.taskId)).resolves.toBe(task.commit);

    // As deleting merged branches does: the tip kept, the worktree and the branch gone.
    await testbed.git.setRef(
      testbed.repository.path,
      testbed.worktrees.branchTipRefOf(task.taskId),
      task.commit,
    );
    await testbed.worktrees.remove(project, task.taskId);
    gitIn(testbed.repository.path, "branch", "--quiet", "-D", task.branch);

    await expect(files.taskBranchTip(project.id, task.taskId)).resolves.toBe(task.commit);
  });

  it("answers undefined for a Task with no branch, nor a tip kept", async () => {
    await expect(files.taskBranchTip(project.id, "task-without-a-branch")).resolves.toBeUndefined();
  });
});

describe("CommittedFiles.taskForkPoint", PUBLISHING_TEST, () => {
  it("is where the tip and the base last met, then where the branch forked as its Publish recorded it", async () => {
    gitIn(testbed.repository.path, "fetch", "--quiet", "origin");
    const forkedFrom = gitIn(testbed.repository.path, "rev-parse", "origin/main");
    const task = await testbed.aTaskWithACommit(project);

    await expect(
      files.taskForkPoint(project.id, task.taskId, task.commit, forkedFrom),
    ).resolves.toBe(forkedFrom);

    await testbed.publishing.publish(project, task.taskId, commitMessage, "branch-only");

    // A base that took the branch in by a merge holds its tip, where they last met.
    await expect(
      files.taskForkPoint(project.id, task.taskId, task.commit, task.commit),
    ).resolves.toBe(forkedFrom);
  });
});
