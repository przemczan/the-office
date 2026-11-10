import { randomUUID } from "node:crypto";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { GitCommandFailed } from "../../ports/git.js";
import { CommandLineGit } from "./command-line-git.js";
import { exists, serviceVariables, WorktreeMaker } from "./command-line-git.fixtures.js";
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
let firstCommit: string;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  worktrees = new WorktreeMaker(git, repository);
  firstCommit = gitIn(repository.path, "rev-parse", "main");
});

afterAll(async () => {
  await repository.remove();
});

describe("CommandLineGit.inspect", REAL_GIT_TEST, () => {
  it("knows a repository's top-level folder", async () => {
    await expect(git.inspect(repository.path)).resolves.toEqual({ kind: "repository" });
  });

  it("names the repository a folder inside one belongs to", async () => {
    const inspection = await git.inspect(join(repository.path, "src"));

    expect(inspection.kind).toBe("inside-a-repository");
    // The temp folder may be named differently by git (a short name on Windows), so only its end.
    expect(inspection.kind === "inside-a-repository" && inspection.root).toMatch(/repository$/);
  });

  it("tells a folder that is no repository, in git's words", async () => {
    await expect(git.inspect(repository.folder)).resolves.toMatchObject({
      kind: "not-a-repository",
      detail: expect.stringMatching(/not a git repository/i),
    });
  });

  it("tells a missing folder from a file", async () => {
    await expect(git.inspect(join(repository.folder, "nowhere"))).resolves.toEqual({
      kind: "missing",
    });
    await expect(git.inspect(join(repository.path, "src", "index.ts"))).resolves.toEqual({
      kind: "not-a-folder",
    });
  });
});

describe("CommandLineGit.hasBranch", REAL_GIT_TEST, () => {
  it("finds a local branch", async () => {
    await expect(git.hasBranch(repository.path, "main")).resolves.toBe(true);
  });

  it.each(["develop", "main..other", "-x"])("finds no branch %s", async (branch) => {
    await expect(git.hasBranch(repository.path, branch)).resolves.toBe(false);
  });
});

describe("CommandLineGit.localBranches", REAL_GIT_TEST, () => {
  it("lists the local branches by name, the checked-out one marked", async () => {
    const own = await createTemporaryRepository();
    try {
      gitIn(own.path, "branch", "release/1.0");

      await expect(git.localBranches(own.path)).resolves.toEqual([
        { name: "main", checkedOut: true },
        { name: "release/1.0", checkedOut: false },
      ]);
    } finally {
      await own.remove();
    }
  });
});

describe("CommandLineGit.fetch", REAL_GIT_TEST, () => {
  it("updates the remote-tracking branch and returns its commit", async () => {
    const commit = await commitOnOrigin(repository, "fetched", "fetched.txt");

    await expect(
      git.fetch(repository.path, { remote: "origin", branch: "fetched" }, serviceVariables),
    ).resolves.toBe(commit);
    expect(gitIn(repository.path, "rev-parse", "refs/remotes/origin/fetched")).toBe(commit);
  });

  it("refuses a branch the remote doesn't have, in git's words", async () => {
    const fetching = git.fetch(
      repository.path,
      { remote: "origin", branch: "nowhere" },
      serviceVariables,
    );

    await expect(fetching).rejects.toBeInstanceOf(GitCommandFailed);
    await expect(fetching).rejects.toThrow(/couldn't find remote ref/i);
  });
});

describe("CommandLineGit.remoteBranches", REAL_GIT_TEST, () => {
  it("reads the default branch and every branch without cloning", async () => {
    const branches = await git.remoteBranches(repository.originPath);

    expect(branches.defaultBranch).toBe("main");
    expect(branches.branches).toContain("main");
  });

  it("finds no default branch in a repository without commits", async () => {
    const empty = join(repository.folder, `empty-${randomUUID()}.git`);
    gitIn(repository.folder, "init", "--quiet", "--bare", empty);

    await expect(git.remoteBranches(empty)).resolves.toEqual({
      defaultBranch: undefined,
      branches: [],
    });
  });
});

/** A path for a clone in a folder of its own. */
function clonePath(): string {
  return join(repository.folder, "repositories", randomUUID(), "shop");
}

describe("CommandLineGit.clone", REAL_GIT_TEST, () => {
  it("clones the whole repository into the folder, telling how far it has got", async () => {
    const folder = clonePath();
    const progress: string[] = [];

    await git.clone({
      url: repository.originPath,
      folder,
      onProgress: ({ phase }) => progress.push(phase),
      signal: new AbortController().signal,
    });

    expect(gitIn(folder, "rev-parse", "HEAD")).toBe(firstCommit);
    expect(gitIn(folder, "branch", "--show-current")).toBe("main");
    expect(progress[0]).toBe("Cloning");
  });

  it("leaves no folder when git refuses", async () => {
    const folder = clonePath();
    const cloning = git.clone({
      url: join(repository.folder, "nowhere.git"),
      folder,
      onProgress: () => undefined,
      signal: new AbortController().signal,
    });

    await expect(cloning).rejects.toBeInstanceOf(GitCommandFailed);
    expect(await exists(folder)).toBe(false);
    expect(await readdir(join(folder, ".."))).toEqual([]);
  });
});

describe("CommandLineGit.push", REAL_GIT_TEST, () => {
  it("pushes a local branch into another branch of the remote when it adds to it", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "merged.txt"), "merged\n");
    const commit = await git.commit(worktree.path, "Add merged.txt", serviceVariables);
    const target = `target-${worktrees.count}`;
    gitIn(repository.path, "push", "--quiet", "origin", `main:refs/heads/${target}`);

    await git.push(
      repository.path,
      worktree.branch,
      { remote: "origin", branch: target },
      serviceVariables,
    );

    expect(gitIn(repository.originPath, "rev-parse", target)).toBe(commit);
    expect(gitIn(repository.path, "rev-parse", `refs/remotes/origin/${target}`)).toBe(commit);
  });

  it("is refused in the remote's words when the remote refuses it", async () => {
    const worktree = await worktrees.aWorktree();
    const hook = join(repository.originPath, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'refusing every push' >&2\nexit 1\n", { mode: 0o755 });
    try {
      const pushing = git.push(
        repository.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        serviceVariables,
      );

      await expect(pushing).rejects.toBeInstanceOf(GitCommandFailed);
      await expect(pushing).rejects.toThrow(/refusing every push/);
    } finally {
      await rm(hook);
    }
  });
});

describe("CommandLineGit.contains", REAL_GIT_TEST, () => {
  it("knows whether a revision was made on another", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "later.txt"), "later\n");
    await git.commit(worktree.path, "Add later.txt", serviceVariables);

    await expect(git.contains(repository.path, worktree.branch, "main")).resolves.toBe(true);
    await expect(git.contains(repository.path, "main", worktree.branch)).resolves.toBe(false);
  });

  it("throws for a revision git doesn't know", async () => {
    await expect(git.contains(repository.path, "main", "nowhere")).rejects.toBeInstanceOf(
      GitCommandFailed,
    );
  });
});

describe("CommandLineGit.upstreamOf", REAL_GIT_TEST, () => {
  it("names the remote branch a branch tracks", async () => {
    gitIn(repository.path, "branch", "--quiet", "tracking", "main");
    await expect(git.upstreamOf(repository.path, "tracking")).resolves.toBeUndefined();

    gitIn(repository.path, "fetch", "--quiet", "origin");
    gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "tracking");

    await expect(git.upstreamOf(repository.path, "tracking")).resolves.toEqual({
      remote: "origin",
      branch: "main",
    });
  });

  it("finds none for a branch that tracks a local one", async () => {
    gitIn(repository.path, "branch", "--quiet", "--track", "tracking-local", "main");

    await expect(git.upstreamOf(repository.path, "tracking-local")).resolves.toBeUndefined();
  });
});
