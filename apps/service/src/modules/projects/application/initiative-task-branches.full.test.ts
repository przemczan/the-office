import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { PublishingTestbed, pullRequestText } from "../adapters/git/publishing-testbed.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project } from "../domain/project.js";
import { BranchUpdates } from "./branch-updates.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Resolving } from "./resolving.js";

// A Task of an Initiative with a Pipeline, on real git: its Initiative's branch, then the base.
let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let updates: BranchUpdates;
let resolving: Resolving;
let project: Project;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository } = testbed);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  updates = new BranchUpdates(testbed.git, commands, testbed.worktrees);
  resolving = new Resolving(testbed.git, commands, testbed.worktrees, testbed.taskBases);
  project = testbed.mergingProject();
});

afterAll(async () => {
  await testbed.remove();
});

function headOf(taskId: string): string {
  return gitIn(testbed.worktrees.pathOf(project, taskId), "rev-parse", "HEAD");
}

function subjectOf(taskId: string, revision: string): string {
  return gitIn(testbed.worktrees.pathOf(project, taskId), "log", "-1", "--format=%s", revision);
}

function contains(revision: string, ancestor: string): Promise<boolean> {
  return testbed.git.contains(repository.path, revision, ancestor);
}

describe("A Task's worktree of an Initiative's branch", REAL_GIT_TEST, () => {
  it("starts at the Initiative's branch as the remote has it, when that is ahead", async () => {
    const branch = testbed.anInitiativeBranch("remote-ahead", { pushed: true });
    const remoteTip = await commitOnOrigin(repository, branch, "remote-ahead.txt");
    testbed.taskBases.initiativeBranches.set("starts-remote", branch);

    await testbed.worktrees.open(project, "starts-remote");

    expect(headOf("starts-remote")).toBe(remoteTip);
  });

  it("starts at the local Initiative's branch, when the remote has none", async () => {
    const branch = testbed.anInitiativeBranch("local-only");
    const tree = gitIn(repository.path, "rev-parse", `${branch}^{tree}`);
    const localTip = gitIn(repository.path, "commit-tree", tree, "-p", branch, "-m", "Local");
    gitIn(repository.path, "update-ref", `refs/heads/${branch}`, localTip);
    testbed.taskBases.initiativeBranches.set("starts-local", branch);

    await testbed.worktrees.open(project, "starts-local");

    expect(headOf("starts-local")).toBe(localTip);
  });
});

describe("BranchUpdates.update of an Initiative's Task", REAL_GIT_TEST, () => {
  it("brings in the Initiative's branch, then the base, each one merge commit", async () => {
    const branch = testbed.anInitiativeBranch("update-order", { pushed: true });
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const initiativeTip = await commitOnOrigin(repository, branch, "update-order-initiative.txt");
    const baseTip = await commitOnOrigin(repository, "main", "update-order-main.txt");

    const update = await updates.update(project, task.taskId, "give-back");

    expect(update).toEqual({ kind: "updated", commit: headOf(task.taskId) });
    expect(subjectOf(task.taskId, "HEAD")).toBe(`Merge main from origin into ${task.branch}`);
    expect(subjectOf(task.taskId, "HEAD^1")).toBe(
      `Merge ${branch} from origin into ${task.branch}`,
    );
    await expect(contains(headOf(task.taskId), initiativeTip)).resolves.toBe(true);
    await expect(contains(headOf(task.taskId), baseTip)).resolves.toBe(true);
  });

  it("stops at a conflict with the Initiative's branch, naming it, and gives the branch back", async () => {
    const branch = testbed.anInitiativeBranch("update-conflict-initiative", { pushed: true });
    const file = "update-conflict-initiative.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, branch, file);
    await commitOnOrigin(repository, "main", "update-conflict-initiative-main.txt");

    await expect(updates.update(project, task.taskId, "give-back")).resolves.toEqual({
      kind: "conflicted",
      conflictedFiles: [file],
      from: branch,
    });
    expect(headOf(task.taskId)).toBe(task.commit);
  });

  it("keeps the clean merge of the Initiative's branch when the base conflicts, giving only that back", async () => {
    const branch = testbed.anInitiativeBranch("update-conflict-base", { pushed: true });
    const file = "update-conflict-base.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, branch, "update-conflict-base-initiative.txt");
    await commitOnOrigin(repository, "main", file);

    const update = await updates.update(project, task.taskId, "give-back");

    const head = headOf(task.taskId);
    expect(update).toEqual({
      kind: "conflicted",
      conflictedFiles: [file],
      from: "main",
      commit: head,
    });
    expect(subjectOf(task.taskId, "HEAD")).toBe(`Merge ${branch} from origin into ${task.branch}`);
    await expect(
      testbed.git.mergeConflicts(testbed.worktrees.pathOf(project, task.taskId)),
    ).resolves.toEqual([]);
  });

  it("leaves the base's conflict in the worktree after the clean merge, reporting where HEAD is", async () => {
    const branch = testbed.anInitiativeBranch("update-leave-base", { pushed: true });
    const file = "update-leave-base.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, branch, "update-leave-base-initiative.txt");
    await commitOnOrigin(repository, "main", file);

    const update = await updates.update(project, task.taskId, "leave");

    expect(update).toEqual({
      kind: "conflicted",
      conflictedFiles: [file],
      from: "main",
      commit: headOf(task.taskId),
    });
    await expect(
      testbed.git.mergeConflicts(testbed.worktrees.pathOf(project, task.taskId)),
    ).resolves.toEqual([file]);
  });

  it("takes a move along the Initiative's branch as a move along the base", async () => {
    const branch = testbed.anInitiativeBranch("moved-along", { pushed: true });
    testbed.taskBases.initiativeBranches.set("moved-along", branch);
    const { path } = await testbed.worktrees.open(project, "moved-along");
    const from = headOf("moved-along");
    const initiativeTip = await commitOnOrigin(repository, branch, "moved-along.txt");
    gitIn(path, "fetch", "--quiet", "origin", branch);
    gitIn(path, "merge", "--quiet", "--ff-only", initiativeTip);

    await expect(updates.movedAlongBase(project, "moved-along", from)).resolves.toBe(true);
  });
});

describe("Resolving an Initiative's Task", REAL_GIT_TEST, () => {
  it("merges the Initiative's branch, then leaves the base's conflict, and commits it as the base's merge", async () => {
    const branch = testbed.anInitiativeBranch("resolve-base", { pushed: true });
    const file = "resolve-base.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    const initiativeTip = await commitOnOrigin(repository, branch, "resolve-base-initiative.txt");
    await commitOnOrigin(repository, "main", file);

    const start = await resolving.start(project, task.taskId);

    expect(start).toEqual({
      kind: "conflicted",
      base: { remote: "origin", branch: "main" },
      conflictedFiles: [file],
      commit: headOf(task.taskId),
    });
    await expect(contains(headOf(task.taskId), initiativeTip)).resolves.toBe(true);
    await writeFile(join(testbed.worktrees.pathOf(project, task.taskId), file), "both\n");
    const end = await resolving.finish(project, task.taskId);
    expect(end).toEqual({ kind: "resolved", commit: headOf(task.taskId) });
    expect(subjectOf(task.taskId, "HEAD")).toBe(`Merge main from origin into ${task.branch}`);
  });

  it("leaves a conflict with the Initiative's branch, and commits it as that branch's merge", async () => {
    const branch = testbed.anInitiativeBranch("resolve-initiative", { pushed: true });
    const file = "resolve-initiative.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, branch, file);

    await expect(resolving.start(project, task.taskId)).resolves.toEqual({
      kind: "conflicted",
      base: { remote: "origin", branch },
      conflictedFiles: [file],
    });
    await writeFile(join(testbed.worktrees.pathOf(project, task.taskId), file), "both\n");
    await expect(resolving.finish(project, task.taskId)).resolves.toMatchObject({
      kind: "resolved",
    });
    expect(subjectOf(task.taskId, "HEAD")).toBe(`Merge ${branch} from origin into ${task.branch}`);
  });
});

describe("Changes of an Initiative's Task", REAL_GIT_TEST, () => {
  it("lists only the Task's own files, before Publish and after it", async () => {
    const branch = testbed.anInitiativeBranch("changes", { pushed: true });
    const file = "changes-of-the-task.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, branch, "changes-of-another-task.txt");
    await commitOnOrigin(repository, "main", "changes-on-main.txt");
    await expect(updates.update(project, task.taskId, "give-back")).resolves.toMatchObject({
      kind: "updated",
    });

    const before = await testbed.worktrees.changes(project, task.taskId);
    expect(before.files.map(({ path }) => path)).toEqual([file]);
    const soFar = await testbed.worktrees.changesSoFar(project, task.taskId);
    expect(soFar).toContain(file);
    expect(soFar).not.toContain("changes-on-main.txt");
    expect(soFar).not.toContain("changes-of-another-task.txt");

    await expect(
      testbed.publishing.publish(project, task.taskId, pullRequestText, "publishing-mode"),
    ).resolves.toMatchObject({ kind: "merged" });
    await commitOnOrigin(repository, "main", "changes-on-main-after.txt");
    gitIn(repository.path, "fetch", "--quiet", "origin");

    const after = await testbed.worktrees.changes(project, task.taskId);
    expect(after.files.map(({ path }) => path)).toEqual([file]);
  });
});

describe("CommandLineGit's refs of an Initiative's branch", REAL_GIT_TEST, () => {
  it("moves a ref only from the commit it still names", async () => {
    const branch = testbed.anInitiativeBranch("move-ref");
    const ref = `refs/heads/${branch}`;
    const start = gitIn(repository.path, "rev-parse", ref);
    const tree = gitIn(repository.path, "rev-parse", `${branch}^{tree}`);
    const next = gitIn(repository.path, "commit-tree", tree, "-p", start, "-m", "Next");
    const other = gitIn(repository.path, "commit-tree", tree, "-p", start, "-m", "Other");

    await testbed.git.moveRef(repository.path, ref, next, start);
    await expect(testbed.git.moveRef(repository.path, ref, other, start)).rejects.toThrow(
      "but expected",
    );

    expect(gitIn(repository.path, "rev-parse", ref)).toBe(next);
  });

  it("finds where a branch is checked out, and nowhere for one that isn't", async () => {
    const branch = testbed.anInitiativeBranch("worktree-of");
    const elsewhere = join(repository.folder, "worktree-of");
    gitIn(repository.path, "worktree", "add", "--quiet", elsewhere, branch);

    await expect(testbed.git.worktreeOf(repository.path, branch)).resolves.toBe(elsewhere);
    await expect(testbed.git.worktreeOf(repository.path, "main")).resolves.toBe(repository.path);
    await expect(
      testbed.git.worktreeOf(repository.path, "no-such-branch"),
    ).resolves.toBeUndefined();
  });
});
