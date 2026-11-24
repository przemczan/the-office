import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLISHING_TEST, PublishingTestbed } from "../adapters/git/publishing-testbed.fixtures.js";
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
