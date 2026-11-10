import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
  REAL_GIT_TEST,
} from "../adapters/git/temporary-repository.fixtures.js";
import type { Project } from "../domain/project.js";
import { Worktrees } from "./worktrees.js";
import { worktreesOnATemporaryRepository } from "../worktrees.fixtures.js";

// Real git and real commands on a temporary repository whose main tracks its origin's.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let installLog: string;
let project: Project;
let taskCount = 0;

beforeAll(async () => {
  ({ repository, worktrees, installLog, project } = await worktreesOnATemporaryRepository());
});

afterAll(async () => {
  await repository.remove();
});

function aTaskId(): string {
  taskCount += 1;
  return `task-${taskCount}`;
}

// Real git, making worktrees and commits: slow under a full run.
describe("Worktrees.prepare", REAL_GIT_TEST, () => {
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

  it.each(["../escape", "a/b", "", "with space"])("refuses the Task id %j", async (taskId) => {
    await expect(worktrees.prepare(project, taskId)).rejects.toThrow(
      /can't name a Task's worktree/,
    );
  });
});

// Real git, making worktrees and commits: slow under a full run.
describe("Worktrees with a Task's id", REAL_GIT_TEST, () => {
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
});

describe("Worktrees.remove", REAL_GIT_TEST, () => {
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
