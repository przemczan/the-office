import { readFile, rm, writeFile } from "node:fs/promises";
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

/** A worktree whose branch changes `src/index.ts`, and a commit beside it that moved on from main. */
async function besideAMovedMain(
  mainContent: string,
): Promise<{ path: string; branch: string; main: string }> {
  const worktree = await worktrees.aWorktree();
  await writeFile(join(worktree.path, "src", "index.ts"), "export const task = 1;\n");
  await git.commit(worktree.path, "Change index.ts", serviceVariables);
  const moved = await worktrees.aWorktree();
  await writeFile(join(moved.path, "src", "index.ts"), mainContent);
  await writeFile(join(moved.path, `elsewhere-${worktrees.count}.txt`), "elsewhere\n");
  const main = await git.commit(moved.path, "Move main on", serviceVariables);
  if (!main) throw new Error("The moved branch committed nothing.");
  return { path: worktree.path, branch: worktree.branch, main };
}

describe("CommandLineGit.conflictsOf", REAL_GIT_TEST, () => {
  it("names the files a merge would conflict on, changing no ref or worktree", async () => {
    const { branch, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(repository.path, "rev-parse", branch);

    await expect(git.conflictsOf(repository.path, main, branch)).resolves.toEqual(["src/index.ts"]);
    expect(gitIn(repository.path, "rev-parse", branch)).toBe(before);
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");
  });

  it("finds none when the branch merges cleanly", async () => {
    const { branch, main } = await besideAMovedMain("export {};\n");

    await expect(git.conflictsOf(repository.path, main, branch)).resolves.toEqual([]);
  });
});

describe("CommandLineGit.rebase", REAL_GIT_TEST, () => {
  it("rebases the worktree's branch onto a moved base", async () => {
    const { path, branch, main } = await besideAMovedMain("export {};\n");

    await expect(git.rebase(path, main, serviceVariables)).resolves.toEqual([]);

    expect(gitIn(path, "rev-parse", "HEAD^")).toBe(main);
    expect(gitIn(path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(await readFile(join(path, "src", "index.ts"), "utf8")).toBe("export const task = 1;\n");
  });

  it("names the conflicted files and puts the branch back as it was", async () => {
    const { path, branch, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(path, "rev-parse", "HEAD");

    await expect(git.rebase(path, main, serviceVariables)).resolves.toEqual(["src/index.ts"]);

    expect(gitIn(path, "rev-parse", "HEAD")).toBe(before);
    expect(gitIn(path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(gitIn(path, "status", "--porcelain")).toBe("");
  });
});

function indexPath(worktreePath: string): string {
  return join(worktreePath, "src", "index.ts");
}

describe("CommandLineGit merges", REAL_GIT_TEST, () => {
  it("merges a moved base in cleanly as one merge commit of its message", async () => {
    const { path, branch, main } = await besideAMovedMain("export {};\n");
    const before = gitIn(path, "rev-parse", "HEAD");

    const merge = await git.merge(path, main, "Merge main into the Task", serviceVariables);

    const head = gitIn(path, "rev-parse", "HEAD");
    expect(merge).toEqual({ kind: "merged", commit: head });
    expect(gitIn(path, "rev-list", "--parents", "--max-count=1", "HEAD")).toBe(
      `${head} ${before} ${main}`,
    );
    expect(gitIn(path, "log", "--format=%s", "--max-count=1")).toBe("Merge main into the Task");
    expect(gitIn(path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    await expect(git.hasMergesSince(repository.path, main, `refs/heads/${branch}`)).resolves.toBe(
      true,
    );
  });

  it("leaves a conflicting merge in progress, then commits it once the markers are gone", async () => {
    const { path, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(path, "rev-parse", "HEAD");

    await expect(git.merge(path, main, "Merge main", serviceVariables)).resolves.toEqual({
      kind: "conflicted",
      conflictedFiles: ["src/index.ts"],
    });
    expect(gitIn(path, "rev-parse", "HEAD")).toBe(before);
    expect(await readFile(indexPath(path), "utf8")).toContain("<<<<<<< ");
    await expect(git.mergeConflicts(path)).resolves.toEqual(["src/index.ts"]);
    await expect(git.concludeMerge(path, "Merge main", serviceVariables)).resolves.toEqual({
      kind: "markers-left",
      files: ["src/index.ts"],
    });

    await writeFile(indexPath(path), "export const task = 1;\nexport const other = 2;\n");
    const conclusion = await git.concludeMerge(path, "Merge main", serviceVariables);

    const head = gitIn(path, "rev-parse", "HEAD");
    expect(conclusion).toEqual({ kind: "committed", commit: head });
    expect(gitIn(path, "rev-list", "--parents", "--max-count=1", "HEAD")).toBe(
      `${head} ${before} ${main}`,
    );
    expect(gitIn(path, "status", "--porcelain")).toBe("");
    await expect(git.concludeMerge(path, "Merge main", serviceVariables)).resolves.toEqual({
      kind: "not-merging",
    });
  });

  it("commits a conflict resolved by deleting the file", async () => {
    const { path, main } = await besideAMovedMain("export const other = 2;\n");
    await git.merge(path, main, "Merge main", serviceVariables);

    await rm(indexPath(path));

    await expect(git.concludeMerge(path, "Merge main", serviceVariables)).resolves.toMatchObject({
      kind: "committed",
    });
    expect(gitIn(path, "ls-files", "src")).toBe("");
  });

  it("puts the worktree and the branch back as they were when a merge is aborted", async () => {
    const { path, branch, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(path, "rev-parse", "HEAD");
    await git.merge(path, main, "Merge main", serviceVariables);

    await git.abortMerge(path, serviceVariables);

    expect(gitIn(path, "rev-parse", "HEAD")).toBe(before);
    expect(gitIn(path, "status", "--porcelain")).toBe("");
    expect(await readFile(indexPath(path), "utf8")).toBe("export const task = 1;\n");
    await expect(git.mergeConflicts(path)).resolves.toEqual([]);
    await expect(git.hasMergesSince(repository.path, main, `refs/heads/${branch}`)).resolves.toBe(
      false,
    );
    await expect(git.abortMerge(path, serviceVariables)).resolves.toBeUndefined();
  });
});

describe("CommandLineGit refs", REAL_GIT_TEST, () => {
  it("points a ref of The Office's own at a commit, finds it, and finds none for a missing one", async () => {
    const { branch, main } = await besideAMovedMain("export {};\n");
    const forkPoint = await git.mergeBase(repository.path, main, `refs/heads/${branch}`);
    const ref = `refs/office/published-from/task-${worktrees.count}`;

    await git.setRef(repository.path, ref, forkPoint);

    await expect(git.findCommit(repository.path, ref)).resolves.toBe(forkPoint);
    expect(forkPoint).toBe(firstCommit);
    await expect(git.findCommit(repository.path, "refs/office/nowhere")).resolves.toBeUndefined();
  });

  it("reads a branch's changes since a fork point it is given", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "first.txt"), "first\n");
    const first = await git.commit(worktree.path, "Add first.txt", serviceVariables);
    await writeFile(join(worktree.path, "second.txt"), "second\n");
    await git.commit(worktree.path, "Add second.txt", serviceVariables);
    if (!first) throw new Error("The first commit committed nothing.");

    const changes = await git.branchChanges(repository.path, "main", worktree.branch, first);

    expect(changes.files.map(({ path }) => path)).toEqual(["second.txt"]);
  });
});
