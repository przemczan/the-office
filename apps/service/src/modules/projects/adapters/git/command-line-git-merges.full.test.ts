import { readFile, rm, writeFile } from "node:fs/promises";
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
const besideAMovedMain = movedMainMaker(git, () => worktrees);

describe("CommandLineGit.conflictsOf", REAL_GIT_TEST, () => {
  it("finds none when the branch merges cleanly", async () => {
    const { branch, main } = await besideAMovedMain("export {};\n");

    await expect(git.conflictsOf(repository.path, main, branch)).resolves.toEqual([]);
  });
});

describe("CommandLineGit.pushCommit", REAL_GIT_TEST, () => {
  it("pushes a commit no branch names to a branch on the remote, whose tracking ref follows", async () => {
    const { branch, main } = await besideAMovedMain("export {};\n");
    const commit = await git.writeCommit(
      repository.path,
      `refs/heads/${branch}`,
      [main],
      "Land the Task",
      serviceVariables,
    );
    const target = { remote: "origin", branch: `landed-${worktrees.count}` };

    await git.pushCommit(repository.path, commit, target, serviceVariables);

    expect(gitIn(repository.originPath, "rev-parse", `refs/heads/${target.branch}`)).toBe(commit);
    expect(gitIn(repository.path, "rev-parse", `refs/remotes/origin/${target.branch}`)).toBe(
      commit,
    );
  });
});

function indexPath(worktreePath: string): string {
  return join(worktreePath, "src", "index.ts");
}

describe("CommandLineGit merges", REAL_GIT_TEST, () => {
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
    const { path, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(path, "rev-parse", "HEAD");
    await git.merge(path, main, "Merge main", serviceVariables);

    await git.abortMerge(path, serviceVariables);

    expect(gitIn(path, "rev-parse", "HEAD")).toBe(before);
    expect(gitIn(path, "status", "--porcelain")).toBe("");
    expect(await readFile(indexPath(path), "utf8")).toBe("export const task = 1;\n");
    await expect(git.mergeConflicts(path)).resolves.toEqual([]);
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

    const changes = await git.branchChanges(repository.path, ["main"], worktree.branch, [first]);

    expect(changes.files.map(({ path }) => path)).toEqual(["second.txt"]);
  });
});
