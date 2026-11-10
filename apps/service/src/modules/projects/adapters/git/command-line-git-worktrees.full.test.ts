import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
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

describe("CommandLineGit.addWorktree", REAL_GIT_TEST, () => {
  it("detaches HEAD without a branch", async () => {
    const path = worktrees.aPath();

    await git.addWorktree(
      repository.path,
      { path, checkout: { kind: "detached", startPoint: "main" } },
      serviceVariables,
    );

    await expect(git.head(path)).resolves.toEqual({ commit: firstCommit, branch: undefined });
  });
});

describe("CommandLineGit.checkoutDetached", REAL_GIT_TEST, () => {
  it("moves a detached worktree to the commit, dropping what changed in it", async () => {
    const worktree = worktrees.detachedAtMain();
    await git.addWorktree(repository.path, worktree, serviceVariables);
    const commit = await commitOnOrigin(repository, "moved", "moved.txt");
    await git.fetch(repository.path, { remote: "origin", branch: "moved" }, serviceVariables);
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");

    await git.checkoutDetached(worktree.path, commit, serviceVariables);

    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: undefined });
    await expect(git.restore(worktree.path, serviceVariables)).resolves.toEqual([]);
    await expect(readFile(join(worktree.path, "moved.txt"), "utf8")).resolves.toBeDefined();
  });
});

describe("CommandLineGit.removeWorktree", REAL_GIT_TEST, () => {
  it("removes the worktree with its uncommitted changes and keeps its branch", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "unsaved.txt"), "unsaved\n");

    await git.removeWorktree(repository.path, worktree.path, serviceVariables);

    expect(await exists(worktree.path)).toBe(false);
    expect(gitIn(repository.path, "worktree", "list")).not.toContain(worktree.path);
    await expect(git.hasBranch(repository.path, worktree.branch)).resolves.toBe(true);
  });

  it.each([
    ["the repository's own folder", () => repository.path],
    ["a folder in it", () => join(repository.path, "src")],
  ])("refuses to remove %s", async (_, path) => {
    await expect(git.removeWorktree(repository.path, path(), serviceVariables)).rejects.toThrow(
      /not in a worktree/,
    );
    expect(await exists(join(repository.path, "src", "index.ts"))).toBe(true);
  });

  it("removes a link in the worktree without following it", async () => {
    const worktree = await worktrees.aWorktree();
    const outside = join(repository.folder, "shared-store");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "kept.txt"), "kept\n");
    await mkdir(join(worktree.path, "node_modules"));
    // A junction on Windows, which needs no privilege; a symbolic link on Linux.
    await symlink(outside, join(worktree.path, "node_modules", "linked"), "junction");

    await git.removeWorktree(repository.path, worktree.path, serviceVariables);

    expect(await exists(worktree.path)).toBe(false);
    await expect(readFile(join(outside, "kept.txt"), "utf8")).resolves.toBe("kept\n");
  });

  it("removes a folder git no longer knows as a worktree", async () => {
    const worktree = await worktrees.aWorktree();
    await git.removeWorktree(repository.path, worktree.path, serviceVariables);
    await mkdir(join(worktree.path, "node_modules"), { recursive: true });

    await git.removeWorktree(repository.path, worktree.path, serviceVariables);

    expect(await exists(worktree.path)).toBe(false);
  });

  it("forgets a worktree whose folder is already gone", async () => {
    const worktree = await worktrees.aWorktree();
    await rm(worktree.path, { recursive: true, force: true });

    await git.removeWorktree(repository.path, worktree.path, serviceVariables);

    expect(gitIn(repository.path, "worktree", "list", "--porcelain")).not.toMatch(
      `worktree-${worktrees.count}`,
    );
  });
});

describe("CommandLineGit.commit", REAL_GIT_TEST, () => {
  it("commits nothing when nothing changed", async () => {
    const worktree = await worktrees.aWorktree();

    await expect(git.commit(worktree.path, "Nothing", serviceVariables)).resolves.toBeUndefined();
    await expect(git.head(worktree.path)).resolves.toMatchObject({ commit: firstCommit });
  });

  it("skips the repository's hooks", async () => {
    const worktree = await worktrees.aWorktree();
    const hook = join(repository.path, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await writeFile(join(worktree.path, "hooked.txt"), "hooked\n");

    try {
      await expect(
        git.commit(worktree.path, "Despite the hook", serviceVariables),
      ).resolves.toBeDefined();
    } finally {
      await rm(hook);
    }
  });
});

describe("CommandLineGit.branchChanges", REAL_GIT_TEST, () => {
  it("lists each committed file with its lines, renames and binary files included, and the diff", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "notes.md"), "one\ntwo\n");
    await writeFile(join(worktree.path, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x00]));
    await git.commit(worktree.path, "Implement: the first Stage", serviceVariables);
    gitIn(worktree.path, "mv", "notes.md", "docs.md");
    await git.commit(worktree.path, "Implement: the rename", serviceVariables);
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
    const worktree = await worktrees.aWorktree();
    gitIn(worktree.path, "mv", "src/index.ts", "src/main.ts");
    await git.commit(worktree.path, "Implement: the rename", serviceVariables);

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
    const worktree = await worktrees.aWorktree();
    gitIn(worktree.path, "rm", "--quiet", "src/index.ts");
    await git.commit(worktree.path, "Implement: the deletion", serviceVariables);

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
    const worktree = await worktrees.aWorktree();
    const line = `${"x".repeat(99)}\n`;
    await writeFile(join(worktree.path, "large.txt"), line.repeat(12_000));
    await git.commit(worktree.path, "Implement: a large file", serviceVariables);

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
    const worktree = await worktrees.aWorktree();

    await expect(git.branchChanges(repository.path, "main", worktree.branch)).resolves.toEqual({
      files: [],
      diff: "",
      diffCut: false,
    });
  });
});

describe("CommandLineGit.restore", REAL_GIT_TEST, () => {
  it("reverts tracked files and keeps untracked ones", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const broken = true;\n");
    await writeFile(join(worktree.path, "screenshot.png"), "a screenshot");

    await expect(git.restore(worktree.path, serviceVariables)).resolves.toEqual(["src/index.ts"]);

    await expect(readFile(join(worktree.path, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
    expect(await exists(join(worktree.path, "screenshot.png"))).toBe(true);
  });

  it("changes nothing in a clean worktree", async () => {
    const worktree = await worktrees.aWorktree();

    await expect(git.restore(worktree.path, serviceVariables)).resolves.toEqual([]);
  });
});

describe("CommandLineGit.untracked", REAL_GIT_TEST, () => {
  it("lists the untracked files that aren't ignored, in folders too", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, ".gitignore"), "node_modules/\n");
    await mkdir(join(worktree.path, "node_modules"), { recursive: true });
    await writeFile(join(worktree.path, "node_modules", "dependency.js"), "installed");
    await mkdir(join(worktree.path, "screenshots", "dialog"), { recursive: true });
    await writeFile(join(worktree.path, "screenshots", "dialog", "open.png"), "a screenshot");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");

    await expect(git.untracked(worktree.path, serviceVariables)).resolves.toEqual([
      ".gitignore",
      "screenshots/dialog/open.png",
    ]);
  });
});

describe("CommandLineGit.discard", REAL_GIT_TEST, () => {
  it("drops tracked and untracked changes and keeps ignored files", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, ".gitignore"), "node_modules/\n");
    await git.commit(worktree.path, "Ignore dependencies", serviceVariables);
    await mkdir(join(worktree.path, "node_modules"));
    await writeFile(join(worktree.path, "node_modules", "dependency.js"), "");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const half = true;\n");
    await mkdir(join(worktree.path, "src", "half-done"));
    await writeFile(join(worktree.path, "src", "half-done", "file name.ts"), "");

    const dropped = await git.discard(worktree.path, serviceVariables);

    expect(dropped.toSorted()).toEqual(["src/half-done/file name.ts", "src/index.ts"]);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
    expect(await exists(join(worktree.path, "src", "half-done"))).toBe(false);
    expect(await exists(join(worktree.path, "node_modules", "dependency.js"))).toBe(true);
  });
});

describe("CommandLineGit.addWorktree with an existing branch", REAL_GIT_TEST, () => {
  it("checks the branch out where it is", async () => {
    const first = await worktrees.aWorktree();
    await writeFile(join(first.path, "kept.txt"), "kept\n");
    const commit = await git.commit(first.path, "Add kept.txt", serviceVariables);
    await git.removeWorktree(repository.path, first.path, serviceVariables);
    const path = worktrees.aPath();

    await git.addWorktree(
      repository.path,
      { path, checkout: { kind: "branch", branch: first.branch } },
      serviceVariables,
    );

    await expect(git.head(path)).resolves.toEqual({ commit, branch: first.branch });
  });
});

describe("CommandLineGit.worktreeRecordPath", REAL_GIT_TEST, () => {
  it("names a file outside the worktree's files, which git leaves alone", async () => {
    const worktree = await worktrees.aWorktree();

    const path = await git.worktreeRecordPath(worktree.path, "office-install");
    await writeFile(path, "a stamp");

    expect(path.startsWith(worktree.path)).toBe(false);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("");
    await git.removeWorktree(repository.path, worktree.path, serviceVariables);
    expect(await exists(path)).toBe(false);
  });
});
