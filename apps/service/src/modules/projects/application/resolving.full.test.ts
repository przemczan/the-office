import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
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
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PullRequestRepositoryForTests } from "../ports/pull-request-repository.fixtures.js";
import { CodeHosts } from "./code-hosts.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { IssueFixes } from "./issue-fixes.js";
import { IssueTasks } from "./issue-tasks.js";
import { IssueLinkRepositoryForTests } from "../ports/issue-link-repository.fixtures.js";
import { Publishing } from "./publishing.js";
import { Resolving } from "./resolving.js";
import { Worktrees } from "./worktrees.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";

// Real git on a temporary repository whose main tracks its origin's, which is a bare repository.
let repository: TemporaryRepository;
let git: CommandLineGit;
let worktrees: Worktrees;
let resolving: Resolving;
let publishing: Publishing;
let taskCount = 0;
const variables = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const ORIGIN = { remote: "origin", branch: "main" };
const RESOLVED = "from the Task\nfrom the origin\n";

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  const taskBases = new TaskBasesForTests(git);
  worktrees = new Worktrees(
    git,
    commands,
    taskCommandsOver(commands, git),
    new OfficeDataDirectory(join(repository.folder, "office-data")),
    taskBases,
  );
  resolving = new Resolving(git, commands, worktrees, taskBases);
  // A merging Project opens no pull request, so no code host is needed.
  publishing = new Publishing(
    git,
    new CodeHosts([]),
    commands,
    worktrees,
    taskBases,
    new PullRequestRepositoryForTests(),
    new EventBus(),
    new IssueFixes(new IssueLinkRepositoryForTests(), git, new IssueTasks()),
  );
});

afterAll(async () => {
  await repository.remove();
});

function mergingProject(): Project {
  return aProject({ path: repository.path, publishingMode: "merge" });
}

interface ConflictedTask {
  readonly taskId: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly commit: string;
  readonly file: string;
  readonly baseCommit: string;
}

/** A Task whose one commit adds `file`, which the origin's main then adds too, otherwise. */
async function aTaskConflictingWithTheBase(): Promise<ConflictedTask> {
  taskCount += 1;
  const taskId = `task-${taskCount}`;
  const file = `conflict-${taskCount}.txt`;
  const worktree = await worktrees.open(mergingProject(), taskId);
  await writeFile(join(worktree.path, file), "from the Task\n");
  const commit = await git.commit(worktree.path, `Add ${file}`, variables);
  if (!commit) throw new Error("The Task's commit committed nothing.");
  const baseCommit = await commitOnOrigin(repository, "main", file);
  return { taskId, branch: worktree.branch, worktreePath: worktree.path, commit, file, baseCommit };
}

const MESSAGE = { subject: "Resolve it", body: "", whole: "Resolve it" };

function originMain(): string {
  return gitIn(repository.originPath, "rev-parse", "refs/heads/main");
}

describe("Resolving", REAL_GIT_TEST, () => {
  it("merges the base in, leaving the conflicted file, and commits it once resolved, which Publish then lands as one commit", async () => {
    const task = await aTaskConflictingWithTheBase();

    await expect(resolving.start(mergingProject(), task.taskId)).resolves.toEqual({
      kind: "conflicted",
      base: ORIGIN,
      conflictedFiles: [task.file],
    });
    const conflicted = await readFile(join(task.worktreePath, task.file), "utf8");
    expect(conflicted).toContain("<<<<<<< ");
    await expect(resolving.finish(mergingProject(), task.taskId)).resolves.toEqual({
      kind: "markers-left",
      files: [task.file],
    });

    await writeFile(join(task.worktreePath, task.file), RESOLVED);
    const end = await resolving.finish(mergingProject(), task.taskId);

    const head = gitIn(task.worktreePath, "rev-parse", "HEAD");
    expect(end).toEqual({ kind: "resolved", commit: head });
    expect(gitIn(task.worktreePath, "rev-list", "--parents", "--max-count=1", "HEAD")).toBe(
      `${head} ${task.commit} ${task.baseCommit}`,
    );
    expect(gitIn(task.worktreePath, "log", "--format=%s", "--max-count=1")).toBe(
      `Merge main from origin into ${task.branch}`,
    );
    const publication = await publishing.publish(
      mergingProject(),
      task.taskId,
      MESSAGE,
      "publishing-mode",
    );

    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: ORIGIN,
      commit: originMain(),
      subject: MESSAGE.subject,
      head,
      baseTakenIn: "not-needed",
    });
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", originMain())).toBe(
      `${originMain()} ${task.baseCommit}`,
    );
    expect(gitIn(repository.path, "rev-parse", `${originMain()}^{tree}`)).toBe(
      gitIn(repository.path, "rev-parse", `${head}^{tree}`),
    );
  });

  it("takes a merge already in progress as it is", async () => {
    const task = await aTaskConflictingWithTheBase();
    await resolving.start(mergingProject(), task.taskId);
    await writeFile(join(task.worktreePath, task.file), RESOLVED);

    await expect(resolving.start(mergingProject(), task.taskId)).resolves.toEqual({
      kind: "conflicted",
      base: ORIGIN,
      conflictedFiles: [task.file],
    });

    expect(await readFile(join(task.worktreePath, task.file), "utf8")).toBe(RESOLVED);
    expect(gitIn(task.worktreePath, "rev-parse", "HEAD")).toBe(task.commit);
    await resolving.abandon(mergingProject(), task.taskId);
  });

  it("gives the worktree and the branch back as they were when abandoned", async () => {
    const task = await aTaskConflictingWithTheBase();
    await resolving.start(mergingProject(), task.taskId);

    await resolving.abandon(mergingProject(), task.taskId);

    expect(gitIn(task.worktreePath, "rev-parse", "HEAD")).toBe(task.commit);
    expect(gitIn(task.worktreePath, "status", "--porcelain")).toBe("");
    expect(await readFile(join(task.worktreePath, task.file), "utf8")).toBe("from the Task\n");
    await expect(resolving.finish(mergingProject(), task.taskId)).resolves.toMatchObject({
      kind: "failed",
    });
  });

  it("merges a base that moved past the conflict cleanly, with nothing left for the Agent", async () => {
    const task = await aTaskConflictingWithTheBase();
    gitIn(repository.path, "fetch", "--quiet", "origin");
    gitIn(task.worktreePath, "merge", "--quiet", "--no-edit", "-X", "ours", "origin/main");
    const moved = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    const start = await resolving.start(mergingProject(), task.taskId);

    const head = gitIn(task.worktreePath, "rev-parse", "HEAD");
    expect(start).toEqual({ kind: "merged", base: ORIGIN, commit: head });
    expect(gitIn(task.worktreePath, "rev-parse", "HEAD^2")).toBe(moved);
  });

  it("merges a base that moved on again after Resolve rather than rebasing, keeping the resolution", async () => {
    const task = await aTaskConflictingWithTheBase();
    await resolving.start(mergingProject(), task.taskId);
    await writeFile(join(task.worktreePath, task.file), RESOLVED);
    const end = await resolving.finish(mergingProject(), task.taskId);
    if (end.kind !== "resolved") throw new Error("Resolve's merge wasn't committed.");
    const moved = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    const publication = await publishing.publish(
      mergingProject(),
      task.taskId,
      MESSAGE,
      "publishing-mode",
    );

    const head = gitIn(task.worktreePath, "rev-parse", "HEAD");
    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: ORIGIN,
      commit: originMain(),
      subject: MESSAGE.subject,
      head,
      baseTakenIn: "by-merge",
    });
    expect(gitIn(task.worktreePath, "rev-list", "--parents", "--max-count=1", "HEAD")).toBe(
      `${head} ${end.commit} ${moved}`,
    );
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", originMain())).toBe(
      `${originMain()} ${moved}`,
    );
    expect(await readFile(join(task.worktreePath, task.file), "utf8")).toBe(RESOLVED);
  });
});
