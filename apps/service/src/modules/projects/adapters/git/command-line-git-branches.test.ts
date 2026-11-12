import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import type { Upstream } from "../../ports/git.js";
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

describe("CommandLineGit.createRef", REAL_GIT_TEST, () => {
  it("makes a ref that isn't there and refuses one that is, leaving it as it was", async () => {
    const first = gitIn(repository.path, "rev-parse", "main");
    const second = anotherCommit();
    const ref = "refs/heads/initiative/created";

    await git.createRef(repository.path, ref, first);
    await expect(git.createRef(repository.path, ref, second)).rejects.toThrow(/cannot lock ref/);

    expect(gitIn(repository.path, "rev-parse", ref)).toBe(first);
  });
});

describe("CommandLineGit.removeRef", REAL_GIT_TEST, () => {
  it("removes the ref only while it names the expected commit", async () => {
    const commit = gitIn(repository.path, "rev-parse", "main");
    const other = anotherCommit();
    const ref = "refs/heads/initiative/removed";
    await git.createRef(repository.path, ref, commit);

    await expect(git.removeRef(repository.path, ref, other)).rejects.toThrow(/cannot lock ref/);
    expect(gitIn(repository.path, "rev-parse", ref)).toBe(commit);

    await git.removeRef(repository.path, ref, commit);
    expect(await git.hasBranch(repository.path, "initiative/removed")).toBe(false);
  });
});

describe("CommandLineGit.remoteHasBranch", REAL_GIT_TEST, () => {
  it("asks the remote itself, not the remote-tracking branches known here", async () => {
    await commitOnOrigin(repository, "initiative/on-the-remote", "remote.txt");

    expect(
      await git.remoteHasBranch(
        repository.path,
        upstream("initiative/on-the-remote"),
        serviceVariables,
      ),
    ).toBe(true);
    expect(
      await git.remoteHasBranch(repository.path, upstream("on-the-remote"), serviceVariables),
    ).toBe(false);
    expect(
      await git.remoteHasBranch(repository.path, upstream("initiative/nowhere"), serviceVariables),
    ).toBe(false);
  });
});

function upstream(branch: string): Upstream {
  return { remote: "origin", branch };
}

/** A commit on main's tree that no ref names. */
function anotherCommit(): string {
  return gitIn(repository.path, "commit-tree", "main^{tree}", "-p", "main", "-m", "Another commit");
}
