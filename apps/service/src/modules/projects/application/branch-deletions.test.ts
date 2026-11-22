import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { commitOnOrigin, gitIn } from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { BranchOwner } from "../domain/branch-deletion.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import type { Project } from "../domain/project.js";
import { BranchDeletions } from "./branch-deletions.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import type { ProjectService } from "./project-service.js";
import { PullRequestRecords } from "./pull-request-records.js";

// Deleting merged branches (spec §5.5) on real git: a repository whose main tracks a bare origin.
let testbed: PublishingTestbed;
let deletions: BranchDeletions;
let project: Project;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  project = { ...testbed.mergingProject(), deleteMergedBranches: true };
  const projects = {
    read: (id: string) =>
      id === project.id ? Promise.resolve(project) : Promise.reject(new ProjectNotFound(id)),
    list: () => Promise.resolve([project]),
  } as unknown as ProjectService;
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  deletions = new BranchDeletions(
    projects,
    testbed.git,
    testbed.worktrees,
    commands,
    new ProjectRemotes(testbed.git, officeIdentityForTests()),
    testbed.taskBases,
    new PullRequestRecords(testbed.records),
  );
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

function taskOwner(taskId: string, initiativeBranch?: string): BranchOwner {
  return initiativeBranch === undefined
    ? { kind: "task", taskId }
    : { kind: "task", taskId, initiativeBranch };
}

/** A Task's branch, pushed to the origin, landed on main by Publish in merge mode (a squash). */
async function aMergedTask(): Promise<{ taskId: string; branch: string; commit: string }> {
  const task = await testbed.aTaskWithACommit(project);
  gitIn(testbed.repository.path, "push", "--quiet", "origin", task.branch);
  const publication = await testbed.publishing.publish(
    project,
    task.taskId,
    commitMessage,
    "publishing-mode",
  );
  if (publication.kind !== "merged") throw new Error(`Publish came to ${publication.kind}.`);
  return task;
}

function expectedOf(preview: Awaited<ReturnType<BranchDeletions["judge"]>>) {
  return preview.copies.map(({ kind, commit }) => ({ kind, commit }));
}

describe("BranchDeletions", PUBLISHING_TEST, () => {
  it("deletes a squash-merged Task's branch here and on the remote, removing its clean worktree and keeping its tip", async () => {
    const task = await aMergedTask();
    const worktreePath = testbed.worktrees.pathOf(project, task.taskId);

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview).toEqual({
      branch: task.branch,
      baseBranch: project.baseBranch,
      copies: [
        { kind: "local", name: task.branch, commit: task.commit },
        { kind: "remote", name: `origin/${task.branch}`, commit: task.commit },
      ],
      worktreePath: expect.stringContaining(task.taskId) as string,
      holdsWork: null,
      refusal: null,
    });

    const deletion = await deletions.delete(project.id, task.branch, taskOwner(task.taskId), {
      expected: expectedOf(preview),
      deleteUnmerged: false,
    });

    expect(deletion).toEqual({
      kind: "deleted",
      copies: preview.copies,
      worktreePath: preview.worktreePath,
    });
    expect(testbed.localCommitOf(task.branch)).toBeUndefined();
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
    expect(await testbed.worktrees.exists(project, task.taskId)).toBe(false);
    expect(worktreePath).toContain(task.taskId);
    expect(await deletions.isKnown(project.id, task.branch)).toBe(false);
    expect(await deletions.knownBranches(project.id)).not.toContain(task.branch);
    // The Changes tab reads up to the tip kept.
    const changes = await testbed.worktrees.changes(project, task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`task-${testbed.taskCount}.txt`]);
  });

  it("judges a merged branch moved on after its merge as holding work, naming the commits", async () => {
    const task = await aMergedTask();
    const worktree = testbed.worktrees.pathOf(project, task.taskId);
    await writeFile(join(worktree, "later.txt"), "after the merge\n");
    gitIn(worktree, "add", "later.txt");
    gitIn(worktree, "commit", "--quiet", "-m", "Add later.txt");

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview.refusal).toBeNull();
    expect(preview.holdsWork).toEqual({
      commitCount: 1,
      subjects: ["Add later.txt"],
      unpublishedTaskTitles: [],
    });
    await expect(
      deletions.delete(project.id, task.branch, taskOwner(task.taskId), {
        expected: expectedOf(preview),
        deleteUnmerged: false,
      }),
    ).resolves.toEqual({
      kind: "refused",
      reason: `The branch ${task.branch} in ${project.name} holds commits ${project.baseBranch} doesn't have, so it stays.`,
    });
    expect(testbed.localCommitOf(task.branch)).toBeDefined();

    const anyway = await deletions.delete(project.id, task.branch, taskOwner(task.taskId), {
      expected: expectedOf(preview),
      deleteUnmerged: true,
    });

    expect(anyway.kind).toBe("deleted");
    expect(testbed.localCommitOf(task.branch)).toBeUndefined();
  });

  it("judges an unmerged Task's branch as holding its commits", async () => {
    const task = await testbed.aTaskWithACommit(project);

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview.copies).toEqual([{ kind: "local", name: task.branch, commit: task.commit }]);
    expect(preview.holdsWork).toEqual({
      commitCount: 1,
      subjects: [`Add task-${testbed.taskCount}.txt`],
      unpublishedTaskTitles: [],
    });
  });

  it("refuses a branch whose remote copy moved since it was checked, deleting nothing", async () => {
    const task = await aMergedTask();
    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));
    await commitOnOrigin(testbed.repository, task.branch, "pushed-meanwhile.txt");

    const deletion = await deletions.delete(project.id, task.branch, taskOwner(task.taskId), {
      expected: expectedOf(preview),
      deleteUnmerged: true,
    });

    expect(deletion).toEqual({
      kind: "refused",
      reason: "The branch changed since it was checked; check again.",
    });
    expect(testbed.localCommitOf(task.branch)).toBe(task.commit);
    expect(testbed.originCommitOf(task.branch)).toBeDefined();
  });

  it("refuses a branch checked out in a worktree other than the Task's own, naming where", async () => {
    const task = await aMergedTask();
    await testbed.worktrees.remove(project, task.taskId);
    const elsewhere = join(testbed.repository.folder, `elsewhere-${task.taskId}`);
    gitIn(testbed.repository.path, "worktree", "add", "--quiet", elsewhere, task.branch);

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview.refusal).toMatch(
      new RegExp(
        `^The branch ${task.branch} is checked out at .*elsewhere-${task.taskId}, so it stays\\.$`,
      ),
    );
    gitIn(testbed.repository.path, "worktree", "remove", "--force", elsewhere);
  });

  it("refuses while the Task's own worktree has uncommitted changes", async () => {
    const task = await aMergedTask();
    const worktree = testbed.worktrees.pathOf(project, task.taskId);
    await writeFile(join(worktree, "draft.txt"), "not committed\n");

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview.refusal).toMatch(/^The Task's worktree at .* has uncommitted changes/);
  });

  it("refuses a branch with an open pull request", async () => {
    const task = await testbed.aTaskWithACommit(project);
    const publication = await testbed.publishing.publish(
      testbed.pullRequestProject(),
      task.taskId,
      commitMessage,
      "publishing-mode",
    );
    expect(publication.kind).toBe("pull-request-opened");

    const preview = await deletions.judge(project.id, task.branch, taskOwner(task.taskId));

    expect(preview.refusal).toMatch(/Merge or close its pull request first\.$/);
  });

  it("judges an Initiative's branch with commits no Publish took to the base as holding work, naming its Tasks", async () => {
    const branch = testbed.anInitiativeBranch(`unpublished-${testbed.taskCount}`, { pushed: true });
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const publication = await testbed.publishing.publish(
      project,
      task.taskId,
      commitMessage,
      "publishing-mode",
    );
    expect(publication.kind).toBe("merged");
    const owner: BranchOwner = {
      kind: "initiative",
      tasks: [{ taskId: task.taskId, title: "Add the thing" }],
    };

    const preview = await deletions.judge(project.id, branch, owner);

    expect(preview.refusal).toBeNull();
    expect(preview.holdsWork).toEqual({
      commitCount: 1,
      subjects: [commitMessage.subject],
      unpublishedTaskTitles: ["Add the thing"],
    });
    expect(await deletions.knownBranches(project.id)).toContain(branch);
  });

  it("deletes an Initiative's branch holding nothing beyond the base", async () => {
    const branch = testbed.anInitiativeBranch(`empty-${testbed.taskCount}`, { pushed: true });
    const owner: BranchOwner = { kind: "initiative", tasks: [] };

    const preview = await deletions.judge(project.id, branch, owner);
    expect(preview.holdsWork).toBeNull();
    const deletion = await deletions.delete(project.id, branch, owner, {
      expected: expectedOf(preview),
      deleteUnmerged: false,
    });

    expect(deletion.kind).toBe("deleted");
    expect(testbed.localCommitOf(branch)).toBeUndefined();
    expect(testbed.originCommitOf(branch)).toBeUndefined();
  });

  it("gives the setting and the Projects it is On in", async () => {
    expect(await deletions.deletesMergedBranches(project.id)).toBe(true);
    expect(await deletions.projectsDeletingMergedBranches()).toEqual([project.id]);
  });
});
