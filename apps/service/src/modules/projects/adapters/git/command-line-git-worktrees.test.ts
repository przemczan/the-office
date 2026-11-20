import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "./command-line-git.js";
import { serviceVariables, WorktreeMaker } from "./command-line-git.fixtures.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
  REAL_GIT_TEST,
} from "./temporary-repository.fixtures.js";

const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
let repository: TemporaryRepository;
let worktrees: WorktreeMaker;
let firstCommit: string;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  worktrees = new WorktreeMaker(git, repository);
  firstCommit = gitIn(repository.path, "rev-parse", "main");
});

afterAll(async () => {
  await repository.remove();
});

describe("CommandLineGit.addWorktree", REAL_GIT_TEST, () => {
  it("checks out a new branch at the start point", async () => {
    const worktree = await worktrees.aWorktree();

    await expect(git.head(worktree.path)).resolves.toEqual({
      commit: firstCommit,
      branch: worktree.branch,
    });
    await expect(readFile(join(worktree.path, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
  });

  it("refuses a branch that exists", async () => {
    const adding = git.addWorktree(
      repository.path,
      {
        path: worktrees.aPath(),
        checkout: { kind: "new-branch", branch: "main", startPoint: "main" },
      },
      serviceVariables,
    );

    await expect(adding).rejects.toThrow(/already exists/i);
  });
});

describe("CommandLineGit.commit", REAL_GIT_TEST, () => {
  it("commits every change, untracked files included, with the message as given", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "new.txt"), "new\n");
    const message = 'Implement: "quotes", $dollars and `ticks`\n\nA body on its own line.';

    const commit = await git.commit(worktree.path, message, serviceVariables);

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: worktree.branch });
    expect(gitIn(worktree.path, "log", "-1", "--format=%B")).toBe(message);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
  });
});

describe("CommandLineGit.committedPaths", REAL_GIT_TEST, () => {
  it("gives the paths a commit added, changed and deleted, and both paths of a rename", async () => {
    const worktree = await worktrees.aWorktree();
    await mkdir(join(worktree.path, "docs"));
    await writeFile(join(worktree.path, "README.md"), "# Read me\n");
    await writeFile(join(worktree.path, "docs", "guide.md"), "A guide.\n".repeat(20));
    await git.commit(worktree.path, "Before", serviceVariables);
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "new.txt"), "new\n");
    await rm(join(worktree.path, "README.md"));
    await rename(
      join(worktree.path, "docs", "guide.md"),
      join(worktree.path, "docs", "handbook.md"),
    );
    const commit = await git.commit(worktree.path, "After", serviceVariables);
    if (commit === undefined) throw new Error("The change was committed.");

    const paths = await git.committedPaths(worktree.path, commit);

    expect(paths.toSorted()).toEqual([
      "README.md",
      "docs/guide.md",
      "docs/handbook.md",
      "new.txt",
      "src/index.ts",
    ]);
  });

  it("gives a merge commit's own resolution, not what either branch brought in", async () => {
    const base = await worktrees.aWorktree();
    await writeFile(join(base.path, "from-base.txt"), "base\n");
    await writeFile(join(base.path, "both.txt"), "base\n");
    await git.commit(base.path, "Base", serviceVariables);
    const task = await worktrees.aWorktree();
    await writeFile(join(task.path, "from-task.txt"), "task\n");
    await writeFile(join(task.path, "both.txt"), "task\n");
    await git.commit(task.path, "Task", serviceVariables);
    gitIn(task.path, "merge", "--no-commit", "--no-ff", "--strategy-option=ours", base.branch);
    await writeFile(join(task.path, "both.txt"), "resolved\n");
    await rm(join(task.path, "src", "index.ts"));
    await writeFile(join(task.path, "own.txt"), "own\n");
    const merge = await git.commit(task.path, "Merge", serviceVariables);
    if (merge === undefined) throw new Error("The merge was committed.");

    const paths = await git.committedPaths(task.path, merge);

    expect(paths.toSorted()).toEqual(["both.txt", "own.txt", "src/index.ts"]);
  });

  it("gives nothing for a clean merge", async () => {
    const base = await worktrees.aWorktree();
    await writeFile(join(base.path, "from-base.txt"), "base\n");
    await git.commit(base.path, "Base", serviceVariables);
    const task = await worktrees.aWorktree();
    await writeFile(join(task.path, "from-task.txt"), "task\n");
    await git.commit(task.path, "Task", serviceVariables);
    gitIn(task.path, "merge", "--quiet", "--no-edit", base.branch);

    await expect(
      git.committedPaths(task.path, gitIn(task.path, "rev-parse", "HEAD")),
    ).resolves.toEqual([]);
  });
});
