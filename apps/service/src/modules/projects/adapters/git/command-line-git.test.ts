import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitCommandFailed, type GitVariables, type NewWorktree } from "../../ports/git.js";
import { CommandLineGit } from "./command-line-git.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./temporary-repository.fixtures.js";

const git = new CommandLineGit(new RepositoryLocks());
const variables: GitVariables = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
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

function detachedAtMain(): NewWorktree {
  return { path: aWorktreePath(), checkout: { kind: "detached", startPoint: "main" } };
}

/** A worktree on a new branch at `main`. */
async function aWorktree(): Promise<{ path: string; branch: string }> {
  const path = aWorktreePath();
  const branch = `office/task-${worktreeCount}`;
  await git.addWorktree(
    repository.path,
    { path, checkout: { kind: "new-branch", branch, startPoint: "main" } },
    variables,
  );
  return { path, branch };
}

/** A worktree whose branch changes `src/index.ts`, and a commit beside it that moved on from main. */
async function besideAMovedMain(
  mainContent: string,
): Promise<{ path: string; branch: string; main: string }> {
  const worktree = await aWorktree();
  await writeFile(join(worktree.path, "src", "index.ts"), "export const task = 1;\n");
  await git.commit(worktree.path, "Change index.ts", variables);
  const moved = await aWorktree();
  await writeFile(join(moved.path, "src", "index.ts"), mainContent);
  await writeFile(join(moved.path, `elsewhere-${worktreeCount}.txt`), "elsewhere\n");
  const main = await git.commit(moved.path, "Move main on", variables);
  if (!main) throw new Error("The moved branch committed nothing.");
  return { path: worktree.path, branch: worktree.branch, main };
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
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
    const commit = await commitOnOrigin(repository, "fetched", "fetched.txt");

    await expect(
      git.fetch(repository.path, { remote: "origin", branch: "fetched" }, variables),
    ).resolves.toBe(commit);
    expect(gitIn(repository.path, "rev-parse", "refs/remotes/origin/fetched")).toBe(commit);
  });

  it("refuses a branch the remote doesn't have, in git's words", async () => {
    const fetching = git.fetch(repository.path, { remote: "origin", branch: "nowhere" }, variables);

    await expect(fetching).rejects.toBeInstanceOf(GitCommandFailed);
    await expect(fetching).rejects.toThrow(/couldn't find remote ref/i);
  });
});

describe("CommandLineGit.push", () => {
  it("pushes a local branch to the remote's branch of the same name", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "pushed.txt"), "pushed\n");
    const commit = await git.commit(worktree.path, "Add pushed.txt", variables);

    await git.push(
      repository.path,
      worktree.branch,
      { remote: "origin", branch: worktree.branch },
      variables,
    );

    expect(gitIn(repository.originPath, "rev-parse", worktree.branch)).toBe(commit);
  });

  it("refuses to overwrite commits the remote has and the branch doesn't", async () => {
    const worktree = await aWorktree();
    await commitOnOrigin(repository, worktree.branch, "theirs.txt");
    await writeFile(join(worktree.path, "ours.txt"), "ours\n");
    await git.commit(worktree.path, "Add ours.txt", variables);

    await expect(
      git.push(
        repository.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        variables,
      ),
    ).rejects.toThrow(/rejected/i);
  });

  it("pushes a local branch into another branch of the remote when it adds to it", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "merged.txt"), "merged\n");
    const commit = await git.commit(worktree.path, "Add merged.txt", variables);
    const target = `target-${worktreeCount}`;
    gitIn(repository.path, "push", "--quiet", "origin", `main:refs/heads/${target}`);

    await git.push(
      repository.path,
      worktree.branch,
      { remote: "origin", branch: target },
      variables,
    );

    expect(gitIn(repository.originPath, "rev-parse", target)).toBe(commit);
    expect(gitIn(repository.path, "rev-parse", `refs/remotes/origin/${target}`)).toBe(commit);
  });

  it("is refused in the remote's words when the remote refuses it", async () => {
    const worktree = await aWorktree();
    const hook = join(repository.originPath, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'refusing every push' >&2\nexit 1\n", { mode: 0o755 });
    try {
      const pushing = git.push(
        repository.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        variables,
      );

      await expect(pushing).rejects.toBeInstanceOf(GitCommandFailed);
      await expect(pushing).rejects.toThrow(/refusing every push/);
    } finally {
      await rm(hook);
    }
  });
});

describe("CommandLineGit.contains", () => {
  it("knows whether a revision was made on another", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "later.txt"), "later\n");
    await git.commit(worktree.path, "Add later.txt", variables);

    await expect(git.contains(repository.path, worktree.branch, "main")).resolves.toBe(true);
    await expect(git.contains(repository.path, "main", worktree.branch)).resolves.toBe(false);
  });

  it("throws for a revision git doesn't know", async () => {
    await expect(git.contains(repository.path, "main", "nowhere")).rejects.toBeInstanceOf(
      GitCommandFailed,
    );
  });
});

describe("CommandLineGit.exclusively", { timeout: 30_000 }, () => {
  it("keeps every other git change on the repository waiting while its work makes its own", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "waited.txt"), "waited\n");
    const log: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let fetched!: () => void;
    const fetchedInside = new Promise<void>((resolve) => (fetched = resolve));

    const holding = git.exclusively(repository.path, async () => {
      await git.fetch(repository.path, { remote: "origin", branch: "main" }, variables);
      log.push("fetched inside");
      fetched();
      await released;
      log.push("released");
    });
    // Started once the work holds the repository, so it can only come after.
    await fetchedInside;
    const committing = git
      .commit(worktree.path, "Add waited.txt", variables)
      .then(() => void log.push("committed"));
    // Long enough for the commit to finish, were it not waiting.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(log).toEqual(["fetched inside"]);
    release();
    await Promise.all([holding, committing]);

    expect(log).toEqual(["fetched inside", "released", "committed"]);
  });
});

describe("CommandLineGit.conflictsOf", () => {
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

describe("CommandLineGit.rebase", () => {
  it("rebases the worktree's branch onto a moved base", async () => {
    const { path, branch, main } = await besideAMovedMain("export {};\n");

    await expect(git.rebase(path, main, variables)).resolves.toEqual([]);

    expect(gitIn(path, "rev-parse", "HEAD^")).toBe(main);
    expect(gitIn(path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(await readFile(join(path, "src", "index.ts"), "utf8")).toBe("export const task = 1;\n");
  });

  it("names the conflicted files and puts the branch back as it was", async () => {
    const { path, branch, main } = await besideAMovedMain("export const other = 2;\n");
    const before = gitIn(path, "rev-parse", "HEAD");

    await expect(git.rebase(path, main, variables)).resolves.toEqual(["src/index.ts"]);

    expect(gitIn(path, "rev-parse", "HEAD")).toBe(before);
    expect(gitIn(path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(gitIn(path, "status", "--porcelain")).toBe("");
  });
});

describe("CommandLineGit refs", () => {
  it("points a ref of The Office's own at a commit, finds it, and finds none for a missing one", async () => {
    const { branch, main } = await besideAMovedMain("export {};\n");
    const forkPoint = await git.mergeBase(repository.path, main, `refs/heads/${branch}`);
    const ref = `refs/office/published-from/task-${worktreeCount}`;

    await git.setRef(repository.path, ref, forkPoint);

    await expect(git.findCommit(repository.path, ref)).resolves.toBe(forkPoint);
    expect(forkPoint).toBe(firstCommit);
    await expect(git.findCommit(repository.path, "refs/office/nowhere")).resolves.toBeUndefined();
  });

  it("reads a branch's changes since a fork point it is given", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "first.txt"), "first\n");
    const first = await git.commit(worktree.path, "Add first.txt", variables);
    await writeFile(join(worktree.path, "second.txt"), "second\n");
    await git.commit(worktree.path, "Add second.txt", variables);
    if (!first) throw new Error("The first commit committed nothing.");

    const changes = await git.branchChanges(repository.path, "main", worktree.branch, first);

    expect(changes.files.map(({ path }) => path)).toEqual(["second.txt"]);
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

    await git.addWorktree(
      repository.path,
      { path, checkout: { kind: "detached", startPoint: "main" } },
      variables,
    );

    await expect(git.head(path)).resolves.toEqual({ commit: firstCommit, branch: undefined });
  });

  it("refuses a branch that exists", async () => {
    const adding = git.addWorktree(
      repository.path,
      {
        path: aWorktreePath(),
        checkout: { kind: "new-branch", branch: "main", startPoint: "main" },
      },
      variables,
    );

    await expect(adding).rejects.toThrow(/already exists/i);
  });
});

describe("CommandLineGit.checkoutDetached", () => {
  it("moves a detached worktree to the commit, dropping what changed in it", async () => {
    const worktree = detachedAtMain();
    await git.addWorktree(repository.path, worktree, variables);
    const commit = await commitOnOrigin(repository, "moved", "moved.txt");
    await git.fetch(repository.path, { remote: "origin", branch: "moved" }, variables);
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");

    await git.checkoutDetached(worktree.path, commit, variables);

    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: undefined });
    await expect(git.restore(worktree.path, variables)).resolves.toEqual([]);
    await expect(readFile(join(worktree.path, "moved.txt"), "utf8")).resolves.toBeDefined();
  });
});

describe("CommandLineGit.removeWorktree", () => {
  it("removes the worktree with its uncommitted changes and keeps its branch", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "unsaved.txt"), "unsaved\n");

    await git.removeWorktree(repository.path, worktree.path, variables);

    expect(await exists(worktree.path)).toBe(false);
    expect(gitIn(repository.path, "worktree", "list")).not.toContain(worktree.path);
    await expect(git.hasBranch(repository.path, worktree.branch)).resolves.toBe(true);
  });

  it.each([
    ["the repository's own folder", () => repository.path],
    ["a folder in it", () => join(repository.path, "src")],
  ])("refuses to remove %s", async (_, path) => {
    await expect(git.removeWorktree(repository.path, path(), variables)).rejects.toThrow(
      /not in a worktree/,
    );
    expect(await exists(join(repository.path, "src", "index.ts"))).toBe(true);
  });

  it("removes a link in the worktree without following it", async () => {
    const worktree = await aWorktree();
    const outside = join(repository.folder, "shared-store");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "kept.txt"), "kept\n");
    await mkdir(join(worktree.path, "node_modules"));
    // A junction on Windows, which needs no privilege; a symbolic link on Linux.
    await symlink(outside, join(worktree.path, "node_modules", "linked"), "junction");

    await git.removeWorktree(repository.path, worktree.path, variables);

    expect(await exists(worktree.path)).toBe(false);
    await expect(readFile(join(outside, "kept.txt"), "utf8")).resolves.toBe("kept\n");
  });

  it("removes a folder git no longer knows as a worktree", async () => {
    const worktree = await aWorktree();
    await git.removeWorktree(repository.path, worktree.path, variables);
    await mkdir(join(worktree.path, "node_modules"), { recursive: true });

    await git.removeWorktree(repository.path, worktree.path, variables);

    expect(await exists(worktree.path)).toBe(false);
  });

  it("forgets a worktree whose folder is already gone", async () => {
    const worktree = await aWorktree();
    await rm(worktree.path, { recursive: true, force: true });

    await git.removeWorktree(repository.path, worktree.path, variables);

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

    const commit = await git.commit(worktree.path, message, variables);

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: worktree.branch });
    expect(gitIn(worktree.path, "log", "-1", "--format=%B")).toBe(message);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
  });

  it("commits nothing when nothing changed", async () => {
    const worktree = await aWorktree();

    await expect(git.commit(worktree.path, "Nothing", variables)).resolves.toBeUndefined();
    await expect(git.head(worktree.path)).resolves.toMatchObject({ commit: firstCommit });
  });

  it("skips the repository's hooks", async () => {
    const worktree = await aWorktree();
    const hook = join(repository.path, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await writeFile(join(worktree.path, "hooked.txt"), "hooked\n");

    try {
      await expect(git.commit(worktree.path, "Despite the hook", variables)).resolves.toBeDefined();
    } finally {
      await rm(hook);
    }
  });
});

describe("CommandLineGit.branchChanges", () => {
  it("lists each committed file with its lines, renames and binary files included, and the diff", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "notes.md"), "one\ntwo\n");
    await writeFile(join(worktree.path, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x00]));
    await git.commit(worktree.path, "Implement: the first Stage", variables);
    gitIn(worktree.path, "mv", "notes.md", "docs.md");
    await git.commit(worktree.path, "Implement: the rename", variables);
    await writeFile(join(worktree.path, "uncommitted.txt"), "not a Stage's work yet\n");

    const changes = await git.branchChanges(repository.path, "main", worktree.branch);

    expect(changes.files).toEqual([
      { path: "docs.md", previousPath: undefined, lines: { added: 2, removed: 0 }, deleted: false },
      { path: "logo.png", previousPath: undefined, lines: undefined, deleted: false },
      {
        path: "src/index.ts",
        previousPath: undefined,
        lines: { added: 1, removed: 1 },
        deleted: false,
      },
    ]);
    expect(changes.diff).toContain("-export {};\n+export const changed = true;\n");
    expect(changes.diff).not.toContain("uncommitted.txt");
    expect(changes.diffCut).toBe(false);
  });

  it("tells a file the branch renamed from where it was", async () => {
    const worktree = await aWorktree();
    gitIn(worktree.path, "mv", "src/index.ts", "src/main.ts");
    await git.commit(worktree.path, "Implement: the rename", variables);

    const changes = await git.branchChanges(repository.path, "main", worktree.branch);

    expect(changes.files).toEqual([
      {
        path: "src/main.ts",
        previousPath: "src/index.ts",
        lines: { added: 0, removed: 0 },
        deleted: false,
      },
    ]);
  });

  it("marks a file the branch deleted", async () => {
    const worktree = await aWorktree();
    gitIn(worktree.path, "rm", "--quiet", "src/index.ts");
    await git.commit(worktree.path, "Implement: the deletion", variables);

    const changes = await git.branchChanges(repository.path, "main", worktree.branch);

    expect(changes.files).toEqual([
      {
        path: "src/index.ts",
        previousPath: undefined,
        lines: { added: 0, removed: 1 },
        deleted: true,
      },
    ]);
  });

  it("cuts a long diff after a whole line", async () => {
    const worktree = await aWorktree();
    const line = `${"x".repeat(99)}\n`;
    await writeFile(join(worktree.path, "large.txt"), line.repeat(12_000));
    await git.commit(worktree.path, "Implement: a large file", variables);

    const changes = await git.branchChanges(repository.path, "main", worktree.branch);

    expect(changes.files).toEqual([
      {
        path: "large.txt",
        previousPath: undefined,
        lines: { added: 12_000, removed: 0 },
        deleted: false,
      },
    ]);
    expect(changes.diffCut).toBe(true);
    expect(changes.diff.length).toBeLessThanOrEqual(1_000_000);
    expect(changes.diff.endsWith(`+${line}`)).toBe(true);
  });

  it("is empty for a branch with no commits of its own", async () => {
    const worktree = await aWorktree();

    await expect(git.branchChanges(repository.path, "main", worktree.branch)).resolves.toEqual({
      files: [],
      diff: "",
      diffCut: false,
    });
  });
});

describe("CommandLineGit.restore", () => {
  it("reverts tracked files and keeps untracked ones", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const broken = true;\n");
    await writeFile(join(worktree.path, "screenshot.png"), "a screenshot");

    await expect(git.restore(worktree.path, variables)).resolves.toEqual(["src/index.ts"]);

    await expect(readFile(join(worktree.path, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
    expect(await exists(join(worktree.path, "screenshot.png"))).toBe(true);
  });

  it("changes nothing in a clean worktree", async () => {
    const worktree = await aWorktree();

    await expect(git.restore(worktree.path, variables)).resolves.toEqual([]);
  });
});

describe("CommandLineGit.untracked", () => {
  it("lists the untracked files that aren't ignored, in folders too", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, ".gitignore"), "node_modules/\n");
    await mkdir(join(worktree.path, "node_modules"), { recursive: true });
    await writeFile(join(worktree.path, "node_modules", "dependency.js"), "installed");
    await mkdir(join(worktree.path, "screenshots", "dialog"), { recursive: true });
    await writeFile(join(worktree.path, "screenshots", "dialog", "open.png"), "a screenshot");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");

    await expect(git.untracked(worktree.path, variables)).resolves.toEqual([
      ".gitignore",
      "screenshots/dialog/open.png",
    ]);
  });
});

describe("CommandLineGit.discard", () => {
  it("drops tracked and untracked changes and keeps ignored files", async () => {
    const worktree = await aWorktree();
    await writeFile(join(worktree.path, ".gitignore"), "node_modules/\n");
    await git.commit(worktree.path, "Ignore dependencies", variables);
    await mkdir(join(worktree.path, "node_modules"));
    await writeFile(join(worktree.path, "node_modules", "dependency.js"), "");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const half = true;\n");
    await mkdir(join(worktree.path, "src", "half-done"));
    await writeFile(join(worktree.path, "src", "half-done", "file name.ts"), "");

    const dropped = await git.discard(worktree.path, variables);

    expect(dropped.toSorted()).toEqual(["src/half-done/file name.ts", "src/index.ts"]);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
    expect(await exists(join(worktree.path, "src", "half-done"))).toBe(false);
    expect(await exists(join(worktree.path, "node_modules", "dependency.js"))).toBe(true);
  });
});

describe("CommandLineGit.upstreamOf", () => {
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

describe("CommandLineGit.addWorktree with an existing branch", () => {
  it("checks the branch out where it is", async () => {
    const first = await aWorktree();
    await writeFile(join(first.path, "kept.txt"), "kept\n");
    const commit = await git.commit(first.path, "Add kept.txt", variables);
    await git.removeWorktree(repository.path, first.path, variables);
    const path = aWorktreePath();

    await git.addWorktree(
      repository.path,
      { path, checkout: { kind: "branch", branch: first.branch } },
      variables,
    );

    await expect(git.head(path)).resolves.toEqual({ commit, branch: first.branch });
  });
});

describe("CommandLineGit with a Project's variables", () => {
  it("runs the repository's hooks with them", async () => {
    const hook = join(repository.path, ".git", "hooks", "post-checkout");
    const written = join(repository.folder, "post-checkout.txt");
    await writeFile(hook, `#!/bin/sh\necho "$GREETING" > "${written.replaceAll("\\", "/")}"\n`, {
      mode: 0o755,
    });

    try {
      await git.addWorktree(repository.path, detachedAtMain(), { ...variables, GREETING: "hello" });
    } finally {
      await rm(hook);
    }

    await expect(readFile(written, "utf8")).resolves.toBe("hello\n");
  });
});

describe("CommandLineGit.worktreeRecordPath", () => {
  it("names a file outside the worktree's files, which git leaves alone", async () => {
    const worktree = await aWorktree();

    const path = await git.worktreeRecordPath(worktree.path, "office-install");
    await writeFile(path, "a stamp");

    expect(path.startsWith(worktree.path)).toBe(false);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
    await git.removeWorktree(repository.path, worktree.path, variables);
    expect(await exists(path)).toBe(false);
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
    await commitOnOrigin(repository, "concurrent-one", "one.txt");
    await commitOnOrigin(repository, "concurrent-other", "other.txt");
    await writeFile(join(worktree.path, "concurrent.txt"), "concurrent\n");

    // From the main checkout and from a worktree alike, which name the repository differently.
    await Promise.all([
      recordingGit.fetch(
        repository.path,
        { remote: "origin", branch: "concurrent-one" },
        variables,
      ),
      recordingGit.fetch(
        worktree.path,
        { remote: "origin", branch: "concurrent-other" },
        variables,
      ),
      recordingGit.commit(worktree.path, "Add concurrent.txt", variables),
      recordingGit.push(
        worktree.path,
        worktree.branch,
        { remote: "origin", branch: worktree.branch },
        variables,
      ),
      recordingGit.addWorktree(repository.path, detachedAtMain(), variables),
      recordingGit.addWorktree(worktree.path, detachedAtMain(), variables),
      recordingGit.removeWorktree(repository.path, removed.path, variables),
    ]);

    expect(locks.held).toHaveLength(7);
    expect(new Set(locks.held.map((hold) => hold.key)).size).toBe(1);
    const byStart = locks.held.toSorted((one, other) => one.from - other.from);
    for (const [index, hold] of byStart.slice(1).entries()) {
      expect(hold.from).toBeGreaterThanOrEqual(byStart[index]?.to ?? Infinity);
    }
  });
});
