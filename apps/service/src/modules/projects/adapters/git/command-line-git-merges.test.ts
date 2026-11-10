import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "./command-line-git.js";
import { movedMainMaker, serviceVariables, WorktreeMaker } from "./command-line-git.fixtures.js";
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

beforeAll(async () => {
  repository = await createTemporaryRepository();
  worktrees = new WorktreeMaker(git, repository);
});

afterAll(async () => {
  await repository.remove();
});

/** A worktree whose branch changes `src/index.ts`, and a commit beside it that moved on from main. */
const besideAMovedMain = movedMainMaker(git, () => worktrees);

describe("CommandLineGit.conflictsOf", REAL_GIT_TEST, () => {
  it("names the files a merge would conflict on, changing no ref or worktree", async () => {
    const { branch, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(repository.path, "rev-parse", branch);

    await expect(git.conflictsOf(repository.path, main, branch)).resolves.toEqual(["src/index.ts"]);
    expect(gitIn(repository.path, "rev-parse", branch)).toBe(before);
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");
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
});
