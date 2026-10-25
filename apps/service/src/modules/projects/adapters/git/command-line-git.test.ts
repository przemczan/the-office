import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitCommandFailed } from "../../ports/git.js";
import { CommandLineGit } from "./command-line-git.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./temporary-repository.fixtures.js";

const git = new CommandLineGit(new RepositoryLocks());
let repository: TemporaryRepository;
let firstCommit: string;
let worktreeCount = 0;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  firstCommit = gitIn(repository.path, "rev-parse", "main");
});

afterAll(async () => {
  await repository.remove();
});

/** A path for a new worktree, unlike any other in the file. */
function aWorktreePath(): string {
  worktreeCount += 1;
  return join(repository.folder, "worktrees", `worktree-${worktreeCount}`);
}

/** A worktree on a new branch at `main`. */
async function aWorktree(): Promise<{ path: string; branch: string }> {
  const path = aWorktreePath();
  const branch = `office/task-${worktreeCount}`;
  await git.addWorktree(repository.path, { path, startPoint: "main", branch });
  return { path, branch };
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

/** Commits `file` on `branch` in the origin, through a clone of its own, and returns the commit. */
async function commitOnOrigin(branch: string, file: string): Promise<string> {
  const clonePath = join(repository.folder, `clone-${branch}`);
  gitIn(
    repository.folder,
    "clone",
    "--quiet",
    "--config",
    "core.autocrlf=false",
    repository.originPath,
    clonePath,
  );
  gitIn(clonePath, "config", "user.name", "Someone else");
  gitIn(clonePath, "config", "user.email", "someone@localhost");
  gitIn(clonePath, "checkout", "--quiet", "-B", branch);
  await writeFile(join(clonePath, file), "from the origin\n");
  gitIn(clonePath, "add", ".");
  gitIn(clonePath, "commit", "--quiet", "--message", `Add ${file}`);
  gitIn(clonePath, "push", "--quiet", "origin", branch);
  const commit = gitIn(clonePath, "rev-parse", "HEAD");
  await rm(clonePath, { recursive: true, force: true });
  return commit;
}

describe("CommandLineGit.inspect", () => {
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

describe("CommandLineGit.hasBranch", () => {
  it("finds a local branch", async () => {
    await expect(git.hasBranch(repository.path, "main")).resolves.toBe(true);
  });

  it.each(["develop", "main..other", "-x"])("finds no branch %s", async (branch) => {
    await expect(git.hasBranch(repository.path, branch)).resolves.toBe(false);
  });
});

describe("CommandLineGit.fetch", () => {
  it("updates the remote-tracking branch and returns its commit", async () => {
    const commit = await commitOnOrigin("fetched", "fetched.txt");

    await expect(git.fetch(repository.path, "origin", "fetched")).resolves.toBe(commit);
    expect(gitIn(repository.path, "rev-parse", "refs/remotes/origin/fetched")).toBe(commit);
  });

  it("refuses a branch the remote doesn't have, in git's words", async () => {
    const fetching = git.fetch(repository.path, "origin", "nowhere");

    await expect(fetching).rejects.toBeInstanceOf(GitCommandFailed);
    await expect(fetching).rejects.toThrow(/couldn't find remote ref/i);
  });
});

describe("CommandLineGit.push", () => {
  it("pushes a local branch to the remote's branch of the same name", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "pushed.txt"), "pushed\n");
    const commit = await git.commit(worktree.path, "Add pushed.txt");

    await git.push(repository.path, "origin", worktree.branch);

    expect(gitIn(repository.originPath, "rev-parse", worktree.branch)).toBe(commit);
  });

  it("refuses to overwrite commits the remote has and the branch doesn't", async () => {
    const worktree = await aWorktree();
    await commitOnOrigin(worktree.branch, "theirs.txt");
    await writeFile(join(worktree.path, "ours.txt"), "ours\n");
    await git.commit(worktree.path, "Add ours.txt");

    await expect(git.push(repository.path, "origin", worktree.branch)).rejects.toThrow(/rejected/i);
  });
});

describe("CommandLineGit.addWorktree", () => {
  it("checks out a new branch at the start point", async () => {
    const worktree = await aWorktree();

    await expect(git.head(worktree.path)).resolves.toEqual({
      commit: firstCommit,
      branch: worktree.branch,
    });
    await expect(readFile(join(worktree.path, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
  });

  it("detaches HEAD without a branch", async () => {
    const path = aWorktreePath();

    await git.addWorktree(repository.path, { path, startPoint: "main" });

    await expect(git.head(path)).resolves.toEqual({ commit: firstCommit, branch: undefined });
  });

  it("refuses a branch that exists", async () => {
    const adding = git.addWorktree(repository.path, {
      path: aWorktreePath(),
      startPoint: "main",
      branch: "main",
    });

    await expect(adding).rejects.toThrow(/already exists/i);
  });
});

describe("CommandLineGit.removeWorktree", () => {
  it("removes the worktree with its uncommitted changes and keeps its branch", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "unsaved.txt"), "unsaved\n");

    await git.removeWorktree(repository.path, worktree.path);

    expect(await exists(worktree.path)).toBe(false);
    expect(gitIn(repository.path, "worktree", "list")).not.toContain(worktree.path);
    await expect(git.hasBranch(repository.path, worktree.branch)).resolves.toBe(true);
  });

  it("forgets a worktree whose folder is already gone", async () => {
    const worktree = await aWorktree();
    await rm(worktree.path, { recursive: true, force: true });

    await git.removeWorktree(repository.path, worktree.path);

    expect(gitIn(repository.path, "worktree", "list", "--porcelain")).not.toMatch(
      `worktree-${worktreeCount}`,
    );
  });
});

describe("CommandLineGit.commit", () => {
  it("commits every change, untracked files included, with the message as given", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "new.txt"), "new\n");
    const message = 'Implement: "quotes", $dollars and `ticks`\n\nA body on its own line.';

    const commit = await git.commit(worktree.path, message);

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: worktree.branch });
    expect(gitIn(worktree.path, "log", "-1", "--format=%B")).toBe(message);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
  });

  it("commits nothing when nothing changed", async () => {
    const worktree = await aWorktree();

    await expect(git.commit(worktree.path, "Nothing")).resolves.toBeUndefined();
    await expect(git.head(worktree.path)).resolves.toMatchObject({ commit: firstCommit });
  });

  it("skips the repository's hooks", async () => {
    const worktree = await aWorktree();
    const hook = join(repository.path, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await writeFile(join(worktree.path, "hooked.txt"), "hooked\n");

    try {
      await expect(git.commit(worktree.path, "Despite the hook")).resolves.toBeDefined();
    } finally {
      await rm(hook);
    }
  });
});

describe("CommandLineGit.restore", () => {
  it("reverts tracked files and keeps untracked ones", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const broken = true;\n");
    await writeFile(join(worktree.path, "screenshot.png"), "a screenshot");

    await expect(git.restore(worktree.path)).resolves.toEqual(["src/index.ts"]);

    await expect(readFile(join(worktree.path, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
    expect(await exists(join(worktree.path, "screenshot.png"))).toBe(true);
  });

  it("changes nothing in a clean worktree", async () => {
    const worktree = await aWorktree();

    await expect(git.restore(worktree.path)).resolves.toEqual([]);
  });
});

describe("CommandLineGit.discard", () => {
  it("drops tracked and untracked changes and keeps ignored files", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, ".gitignore"), "node_modules/\n");
    await git.commit(worktree.path, "Ignore dependencies");
    await mkdir(join(worktree.path, "node_modules"));
    await writeFile(join(worktree.path, "node_modules", "dependency.js"), "");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const half = true;\n");
    await mkdir(join(worktree.path, "src", "half-done"));
    await writeFile(join(worktree.path, "src", "half-done", "file name.ts"), "");

    const dropped = await git.discard(worktree.path);

    expect(dropped.toSorted()).toEqual(["src/half-done/file name.ts", "src/index.ts"]);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
    expect(await exists(join(worktree.path, "src", "half-done"))).toBe(false);
    expect(await exists(join(worktree.path, "node_modules", "dependency.js"))).toBe(true);
  });
});

describe("CommandLineGit on one repository", () => {
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
    const recordingGit = new CommandLineGit(locks);
    const worktree = await aWorktree();
    const removed = await aWorktree();
    await commitOnOrigin("concurrent-one", "one.txt");
    await commitOnOrigin("concurrent-other", "other.txt");
    await writeFile(join(worktree.path, "concurrent.txt"), "concurrent\n");

    // From the main checkout and from a worktree alike, which name the repository differently.
    await Promise.all([
      recordingGit.fetch(repository.path, "origin", "concurrent-one"),
      recordingGit.fetch(worktree.path, "origin", "concurrent-other"),
      recordingGit.commit(worktree.path, "Add concurrent.txt"),
      recordingGit.push(worktree.path, "origin", worktree.branch),
      recordingGit.addWorktree(repository.path, { path: aWorktreePath(), startPoint: "main" }),
      recordingGit.addWorktree(worktree.path, { path: aWorktreePath(), startPoint: "main" }),
      recordingGit.removeWorktree(repository.path, removed.path),
    ]);

    expect(locks.held).toHaveLength(7);
    expect(new Set(locks.held.map((hold) => hold.key)).size).toBe(1);
    const byStart = locks.held.toSorted((one, other) => one.from - other.from);
    for (const [index, hold] of byStart.slice(1).entries()) {
      expect(hold.from).toBeGreaterThanOrEqual(byStart[index]?.to ?? Infinity);
    }
  });
});
