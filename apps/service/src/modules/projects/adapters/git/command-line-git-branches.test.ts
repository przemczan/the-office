import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "./command-line-git.js";
import { serviceVariables, WorktreeMaker } from "./command-line-git.fixtures.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  commitOnOrigin,
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

describe("CommandLineGit.push", REAL_GIT_TEST, () => {
  it("pushes a local branch to the remote's branch of the same name", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "pushed.txt"), "pushed\n");
    const commit = await git.commit(worktree.path, "Add pushed.txt", serviceVariables);

    await git.push(
      repository.path,
      worktree.branch,
      { remote: "origin", branch: worktree.branch },
      serviceVariables,
    );

    expect(gitIn(repository.originPath, "rev-parse", worktree.branch)).toBe(commit);
  });

  it("refuses to overwrite commits the remote has and the branch doesn't", async () => {
    const worktree = await worktrees.aWorktree();
    await commitOnOrigin(repository, worktree.branch, "theirs.txt");
    await writeFile(join(worktree.path, "ours.txt"), "ours\n");
    await git.commit(worktree.path, "Add ours.txt", serviceVariables);

    await expect(
      git.push(
        repository.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        serviceVariables,
      ),
    ).rejects.toThrow(/rejected/i);
  });
});
