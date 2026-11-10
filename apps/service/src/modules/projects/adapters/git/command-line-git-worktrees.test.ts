import { readFile, writeFile } from "node:fs/promises";
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
