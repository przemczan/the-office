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

describe("CommandLineGit.exclusively", REAL_GIT_TEST, () => {
  it("keeps every other git change on the repository waiting while its work makes its own", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "waited.txt"), "waited\n");
    const log: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let fetched!: () => void;
    const fetchedInside = new Promise<void>((resolve) => (fetched = resolve));

    const holding = git.exclusively(repository.path, async () => {
      await git.fetch(repository.path, { remote: "origin", branch: "main" }, serviceVariables);
      log.push("fetched inside");
      fetched();
      await released;
      log.push("released");
    });
    // Started once the work holds the repository, so it can only come after.
    await fetchedInside;
    const committing = git
      .commit(worktree.path, "Add waited.txt", serviceVariables)
      .then(() => void log.push("committed"));
    // Long enough for the commit to finish, were it not waiting.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(log).toEqual(["fetched inside"]);
    release();
    await Promise.all([holding, committing]);

    expect(log).toEqual(["fetched inside", "released", "committed"]);
  });
});

describe("CommandLineGit on one repository", REAL_GIT_TEST, () => {
  /** Records when each piece of work held its repository's lock. */
  class RecordingLocks extends RepositoryLocks {
    readonly held: { key: string; from: number; to: number }[] = [];

    override run<Result>(key: string, work: () => Promise<Result>): Promise<Result> {
      return super.run(key, async () => {
        const from = performance.now();
        try {
          return await work();
        } finally {
          this.held.push({ key, from, to: performance.now() });
        }
      });
    }
  }

  it("never fetches, pushes, commits or changes worktrees at the same time", async () => {
    const locks = new RecordingLocks();
    const recordingGit = new CommandLineGit(locks, officeIdentityForTests());
    const worktree = await worktrees.aWorktree();
    const removed = await worktrees.aWorktree();
    await commitOnOrigin(repository, "concurrent-one", "one.txt");
    await commitOnOrigin(repository, "concurrent-other", "other.txt");
    await writeFile(join(worktree.path, "concurrent.txt"), "concurrent\n");

    // From the main checkout and from a worktree alike, which name the repository differently.
    await Promise.all([
      recordingGit.fetch(
        repository.path,
        { remote: "origin", branch: "concurrent-one" },
        serviceVariables,
      ),
      recordingGit.fetch(
        worktree.path,
        { remote: "origin", branch: "concurrent-other" },
        serviceVariables,
      ),
      recordingGit.commit(worktree.path, "Add concurrent.txt", serviceVariables),
      recordingGit.push(
        worktree.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        serviceVariables,
      ),
      recordingGit.addWorktree(repository.path, worktrees.detachedAtMain(), serviceVariables),
      recordingGit.addWorktree(worktree.path, worktrees.detachedAtMain(), serviceVariables),
      recordingGit.removeWorktree(repository.path, removed.path, serviceVariables),
    ]);

    expect(locks.held).toHaveLength(7);
    expect(new Set(locks.held.map((hold) => hold.key)).size).toBe(1);
    const byStart = locks.held.toSorted((one, other) => one.from - other.from);
    for (const [index, hold] of byStart.slice(1).entries()) {
      expect(hold.from).toBeGreaterThanOrEqual(byStart[index]?.to ?? Infinity);
    }
  });
});
