import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

// Real git and real commands on a temporary repository whose main tracks its origin's.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let installLog: string;
let project: Project;
let taskCount = 0;

/** An install that adds one "x" to the log, so a test can count installs. */
const COUNTING_INSTALL = `node -e "require('fs').appendFileSync(process.env.INSTALL_LOG, 'x')"`;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  installLog = join(repository.folder, "installs.log");
  worktrees = new Worktrees(
    new CommandLineGit(new RepositoryLocks()),
    new ProjectCommandRunner(new ShellCommandRunner()),
    new OfficeDataDirectory(join(repository.folder, "office-data")),
  );
  project = aProject({
    path: repository.path,
    commands: { ...aProject().commands, install: COUNTING_INSTALL },
    installInputs: ["package-lock.json"],
    environment: { set: [{ name: "INSTALL_LOG", value: installLog }], unset: [], prependPath: [] },
  });
});

afterAll(async () => {
  await repository.remove();
});

function aTaskId(): string {
  taskCount += 1;
  return `task-${taskCount}`;
}

async function installs(): Promise<number> {
  return (await readFile(installLog, "utf8").catch(() => "")).length;
}

describe("Worktrees.prepare", () => {
  it("makes the Task's worktree at a stable path, on its branch at the freshly fetched base", async () => {
    const fetched = await commitOnOrigin(repository, "main", "fetched.txt");
    const taskId = aTaskId();

    const { worktree, installation } = await worktrees.prepare(project, taskId);

    expect(worktree).toEqual({
      path: join(repository.folder, "office-data", "worktrees", "admin-panel", taskId),
      branch: `office/${taskId}`,
    });
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(fetched);
    expect(gitIn(worktree.path, "symbolic-ref", "--short", "HEAD")).toBe(`office/${taskId}`);
    expect(installation).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
  });

  it("starts at the local base branch when it tracks no remote branch", async () => {
    gitIn(repository.path, "branch", "--quiet", "local-base", "main");
    const localBase = { ...project, baseBranch: "local-base" };

    const { worktree } = await worktrees.prepare(localBase, aTaskId());

    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(
      gitIn(repository.path, "rev-parse", "local-base"),
    );
  });

  it("gives the worktree back as the Task left it, without installing again", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "half-done.txt"), "not committed\n");
    const before = await installs();

    const again = await worktrees.prepare(project, taskId);

    expect(again.worktree).toEqual(worktree);
    expect(again.installation).toEqual({ kind: "up-to-date" });
    await expect(readFile(join(worktree.path, "half-done.txt"), "utf8")).resolves.toBe(
      "not committed\n",
    );
    expect(await installs()).toBe(before);
  });

  it("checks out the Task's branch where it was when its worktree was removed", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "kept.txt"), "kept\n");
    gitIn(worktree.path, "add", ".");
    gitIn(worktree.path, "commit", "--quiet", "--message", "Keep a file");
    const commit = gitIn(worktree.path, "rev-parse", "HEAD");

    await worktrees.remove(project, taskId);
    expect(await stat(worktree.path).catch(() => undefined)).toBeUndefined();
    const again = await worktrees.prepare(project, taskId);

    expect(gitIn(again.worktree.path, "rev-parse", "HEAD")).toBe(commit);
  });

  it.each(["../escape", "a/b", "", "with space"])("refuses the Task id %j", async (taskId) => {
    await expect(worktrees.prepare(project, taskId)).rejects.toThrow(
      /can't name a Task's worktree/,
    );
  });
});

describe("Worktrees.open", () => {
  it("makes the Task's worktree at the freshly fetched base without installing, as planning reads it", async () => {
    const fetched = await commitOnOrigin(repository, "main", "planned.txt");
    const taskId = aTaskId();
    const before = await installs();

    const worktree = await worktrees.open(project, taskId);

    expect(worktree).toEqual({
      path: worktrees.pathOf(project, taskId),
      branch: `office/${taskId}`,
    });
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(fetched);
    expect(await installs()).toBe(before);
    expect((await worktrees.prepare(project, taskId)).installation).toMatchObject({ kind: "ran" });
  });
});

describe("Worktrees.install", () => {
  it("installs again only when the install command, an install input or the environment changes", async () => {
    const { worktree } = await worktrees.prepare(project, aTaskId());
    const count = await installs();

    await writeFile(join(worktree.path, "unrelated.txt"), "changed\n");
    await expect(worktrees.install(project, worktree.path)).resolves.toEqual({
      kind: "up-to-date",
    });

    await writeFile(join(worktree.path, "package-lock.json"), "{}\n");
    await worktrees.install(project, worktree.path);
    expect(await installs()).toBe(count + 1);

    const changedCommand = {
      ...project,
      commands: { ...project.commands, install: `${COUNTING_INSTALL} && echo again` },
    };
    await worktrees.install(changedCommand, worktree.path);
    expect(await installs()).toBe(count + 2);

    const changedEnvironment = {
      ...project.environment,
      set: [...project.environment.set, { name: "EXTRA", value: "1" }],
    };
    await worktrees.install(changedCommand, worktree.path, { environment: changedEnvironment });
    expect(await installs()).toBe(count + 3);
  });

  it("tries again after an install that failed", async () => {
    const { worktree } = await worktrees.prepare(project, aTaskId());
    const failing = {
      ...project,
      commands: { ...project.commands, install: `node -e "process.exit(1)"` },
    };

    await expect(worktrees.install(failing, worktree.path)).resolves.toMatchObject({
      kind: "ran",
      run: { outcome: "failed", exitCode: 1 },
    });
    await expect(worktrees.install(failing, worktree.path)).resolves.toMatchObject({ kind: "ran" });
  });
});

describe("Worktrees with a Task's id", () => {
  it("commits, reports, restores and discards in the Task's worktree, with the Project's variables", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    const hook = join(repository.path, ".git", "hooks", "post-commit");
    const hookLog = join(repository.folder, `post-commit-${taskId}.log`);
    const hookScript = `#!/bin/sh\nprintf '%s\\n' "$INSTALL_LOG" > "${hookLog.replaceAll("\\", "/")}"\n`;
    await writeFile(hook, hookScript, { mode: 0o755 });
    await writeFile(join(worktree.path, "stage.txt"), "a Stage's work\n");

    let commit: string | undefined;
    try {
      commit = await worktrees.commit(project, taskId, "Implement: a Stage's work");
    } finally {
      await rm(hook);
    }

    await expect(worktrees.head(project, taskId)).resolves.toEqual({
      commit,
      branch: worktree.branch,
    });
    await expect(readFile(hookLog, "utf8")).resolves.toBe(`${installLog}\n`);
    await writeFile(join(worktree.path, "stage.txt"), "changed by a test run\n");
    await writeFile(join(worktree.path, "screenshot.png"), "a screenshot");
    await expect(worktrees.restore(project, taskId)).resolves.toEqual(["stage.txt"]);
    await writeFile(join(worktree.path, "half-done.txt"), "interrupted\n");
    await expect(worktrees.discard(project, taskId)).resolves.toEqual(
      expect.arrayContaining(["half-done.txt", "screenshot.png"]),
    );
  });

  it("summarises what the Task's commits changed since its branch left the base, without the base's later commits", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await expect(worktrees.changesSoFar(project, taskId)).resolves.toBeUndefined();

    await writeFile(join(worktree.path, "renamed.txt"), "a Stage's work\n");
    await worktrees.commit(project, taskId, "Implement: a Stage's work");
    await commitOnOrigin(repository, "main", `later-${taskId}.txt`);
    gitIn(repository.path, "fetch", "--quiet", "origin");
    await writeFile(join(worktree.path, "uncommitted.txt"), "not yet a Stage's work\n");

    const summary = await worktrees.changesSoFar(project, taskId);
    expect(summary).toMatch(/^ renamed\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)$/);
  });
});

describe("Worktrees.changes", () => {
  it("has none before the Task has a branch", async () => {
    await expect(worktrees.changes(project, aTaskId())).resolves.toEqual({
      files: [],
      diff: "",
      diffCut: false,
    });
  });

  it("reads the Task's committed changes against the fetched base, without its later commits, after the worktree is gone too", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "work.txt"), "a Stage's work\n");
    await worktrees.commit(project, taskId, "Implement: a Stage's work");
    await commitOnOrigin(repository, "main", `later-${taskId}.txt`);
    gitIn(repository.path, "fetch", "--quiet", "origin");
    const expected = [
      { path: "work.txt", previousPath: undefined, lines: { added: 1, removed: 0 } },
    ];

    await expect(worktrees.changes(project, taskId)).resolves.toMatchObject({ files: expected });
    await worktrees.remove(project, taskId);
    await expect(worktrees.changes(project, taskId)).resolves.toMatchObject({ files: expected });
  });
});

describe("Worktrees.remove", () => {
  it("removes the worktree with its uncommitted changes and keeps the Task's branch", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "unsaved.txt"), "unsaved\n");

    await worktrees.remove(project, taskId);

    expect(await stat(worktree.path).catch(() => undefined)).toBeUndefined();
    expect(gitIn(repository.path, "branch", "--list", worktree.branch)).toContain(worktree.branch);
    await rm(installLog, { force: true });
  });
});
