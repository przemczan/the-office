import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import { BranchUpdates } from "./branch-updates.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";

// Real git on a temporary repository whose main tracks its origin's, which is a bare repository.
let repository: TemporaryRepository;
let git: CommandLineGit;
let worktrees: Worktrees;
let updates: BranchUpdates;
let taskCount = 0;
const variables = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  worktrees = new Worktrees(
    git,
    commands,
    taskCommandsOver(commands, git),
    new OfficeDataDirectory(join(repository.folder, "office-data")),
    new TaskBasesForTests(git),
  );
  updates = new BranchUpdates(git, commands, worktrees);
});

afterAll(async () => {
  await repository.remove();
});

function project(): Project {
  return aProject({ path: repository.path });
}

interface OpenTask {
  readonly taskId: string;
  readonly path: string;
  readonly startedAt: string;
}

async function aTask(): Promise<OpenTask> {
  taskCount += 1;
  const taskId = `task-${taskCount}`;
  const { path } = await worktrees.open(project(), taskId);
  return { taskId, path, startedAt: (await git.head(path)).commit };
}

/** The branch fast-forwarded to the origin's main, as the user would from a shell. */
async function fastForwarded({ path }: OpenTask): Promise<void> {
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(path, "merge", "--quiet", "--ff-only", "origin/main");
  return Promise.resolve();
}

function originMain(): string {
  return gitIn(repository.originPath, "rev-parse", "refs/heads/main");
}

async function aConflictingTask(): Promise<OpenTask & { readonly file: string }> {
  const task = await aTask();
  const file = `conflict-${task.taskId}.txt`;
  await writeFile(join(task.path, file), "by the Task\n");
  await git.commit(task.path, "Its own", variables);
  await commitOnOrigin(repository, "main", file);
  return { ...task, file };
}

describe("BranchUpdates.movedAlongBase", REAL_GIT_TEST, () => {
  it("takes a fast-forward to the base", async () => {
    const task = await aTask();
    await commitOnOrigin(repository, "main", `ahead-${task.taskId}.txt`);
    await fastForwarded(task);

    await expect(updates.movedAlongBase(project(), task.taskId, task.startedAt)).resolves.toBe(
      true,
    );
  });

  it("takes a HEAD the base has since moved past", async () => {
    const task = await aTask();
    await commitOnOrigin(repository, "main", `first-${task.taskId}.txt`);
    await fastForwarded(task);
    await commitOnOrigin(repository, "main", `second-${task.taskId}.txt`);

    await expect(updates.movedAlongBase(project(), task.taskId, task.startedAt)).resolves.toBe(
      true,
    );
  });

  it("refuses a commit the base doesn't have", async () => {
    const task = await aTask();
    await writeFile(join(task.path, `own-${task.taskId}.txt`), "by hand\n");
    await git.commit(task.path, "By hand", variables);

    await expect(updates.movedAlongBase(project(), task.taskId, task.startedAt)).resolves.toBe(
      false,
    );
  });

  it("refuses a branch moved backwards along the base", async () => {
    const task = await aTask();
    await commitOnOrigin(repository, "main", `ahead-${task.taskId}.txt`);
    await fastForwarded(task);
    const { commit } = await git.head(task.path);
    gitIn(task.path, "reset", "--quiet", "--hard", task.startedAt);

    await expect(updates.movedAlongBase(project(), task.taskId, commit)).resolves.toBe(false);
  });

  it("refuses a worktree holding uncommitted work", async () => {
    const task = await aTask();
    await commitOnOrigin(repository, "main", `ahead-${task.taskId}.txt`);
    await fastForwarded(task);
    await writeFile(join(task.path, `edit-${task.taskId}.txt`), "half done\n");

    await expect(updates.movedAlongBase(project(), task.taskId, task.startedAt)).resolves.toBe(
      false,
    );
  });
});

describe("BranchUpdates.update", REAL_GIT_TEST, () => {
  it("leaves a branch that has the base alone", async () => {
    const task = await aTask();
    await fastForwarded(task);

    await expect(updates.update(project(), task.taskId, "give-back")).resolves.toEqual({
      kind: "up-to-date",
    });
  });

  it("fast-forwards a branch with nothing of its own, with no merge commit", async () => {
    const task = await aTask();
    await commitOnOrigin(repository, "main", `ahead-${task.taskId}.txt`);

    await expect(updates.update(project(), task.taskId, "give-back")).resolves.toEqual({
      kind: "updated",
      commit: originMain(),
    });
    expect((await git.head(task.path)).commit).toBe(originMain());
  });

  it("merges the base into a branch with commits of its own", async () => {
    const task = await aTask();
    await writeFile(join(task.path, `own-${task.taskId}.txt`), "by the Task\n");
    await git.commit(task.path, "Its own", variables);
    await commitOnOrigin(repository, "main", `ahead-${task.taskId}.txt`);

    const update = await updates.update(project(), task.taskId, "give-back");

    const { commit } = await git.head(task.path);
    expect(update).toEqual({ kind: "updated", commit });
    await expect(git.contains(repository.path, commit, originMain())).resolves.toBe(true);
  });

  it("gives the branch back from a conflict when told to", async () => {
    const task = await aConflictingTask();
    const { commit } = await git.head(task.path);

    await expect(updates.update(project(), task.taskId, "give-back")).resolves.toEqual({
      kind: "conflicted",
      conflictedFiles: [task.file],
      from: "main",
    });
    await expect(git.mergeConflicts(task.path)).resolves.toEqual([]);
    expect((await git.head(task.path)).commit).toBe(commit);
  });

  it("leaves a conflict in the worktree when told to, and reports it again", async () => {
    const task = await aConflictingTask();
    const conflicted = { kind: "conflicted", conflictedFiles: [task.file] };

    await expect(updates.update(project(), task.taskId, "leave")).resolves.toEqual({
      ...conflicted,
      from: "main",
    });
    await expect(git.mergeConflicts(task.path)).resolves.toEqual([task.file]);
    // Left from before, so which branch's merge it is isn't known.
    await expect(updates.update(project(), task.taskId, "leave")).resolves.toEqual(conflicted);
  });

  it("answers why when git refuses, as on a change the update would overwrite", async () => {
    const task = await aTask();
    const file = `overwritten-${task.taskId}.txt`;
    await commitOnOrigin(repository, "main", file);
    await writeFile(join(task.path, file), "half done\n");

    await expect(updates.update(project(), task.taskId, "give-back")).resolves.toMatchObject({
      kind: "failed",
    });
  });
});
