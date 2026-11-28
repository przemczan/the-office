import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../office-identity/index.fixtures.js";
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

describe("CommandLineGit.commitFolder", REAL_GIT_TEST, () => {
  it("commits only the folder, its new files included, leaving other staged and unstaged changes as they were", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "staged.txt"), "staged\n");
    gitIn(worktree.path, "add", "staged.txt");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const unstaged = true;\n");
    await writeFile(join(worktree.path, "untracked.txt"), "untracked\n");
    await mkdir(join(worktree.path, ".devcontainer"));
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{}\n");
    const statusBefore = gitIn(worktree.path, "status", "--porcelain", "--", ":!.devcontainer");

    const commit = await git.commitFolder(
      worktree.path,
      ".devcontainer",
      "Add the run environment",
      serviceVariables,
    );

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(git.head(worktree.path)).resolves.toEqual({ commit, branch: worktree.branch });
    expect(gitIn(worktree.path, "log", "-1", "--format=%B")).toBe("Add the run environment");
    expect(gitIn(worktree.path, "show", "--name-only", "--format=", "HEAD")).toBe(
      ".devcontainer/devcontainer.json",
    );
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe(statusBefore);
    expect(gitIn(worktree.path, "diff", "--cached", "--name-only")).toBe("staged.txt");
    expect(gitIn(worktree.path, "diff", "--name-only")).toBe("src/index.ts");
    expect(gitIn(worktree.path, "ls-files", "--others", "--exclude-standard")).toBe(
      "untracked.txt",
    );
  });

  it("commits nothing when the folder is as committed", async () => {
    const worktree = await worktrees.aWorktree();
    const head = gitIn(worktree.path, "rev-parse", "HEAD");
    await writeFile(join(worktree.path, "other.txt"), "other\n");

    await expect(
      git.commitFolder(worktree.path, ".devcontainer", "Nothing", serviceVariables),
    ).resolves.toBeUndefined();
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("CommandLineGit.restoreFolder", REAL_GIT_TEST, () => {
  it("puts the folder back as HEAD has it, staged, unstaged and untracked, leaving everything else as it was", async () => {
    const worktree = await worktrees.aWorktree();
    await mkdir(join(worktree.path, ".devcontainer"));
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{}\n");
    await writeFile(join(worktree.path, ".devcontainer", "Dockerfile"), "FROM node:22\n");
    gitIn(worktree.path, "add", ".devcontainer");
    gitIn(worktree.path, "commit", "--quiet", "--message", "Add the definition");
    await writeFile(join(worktree.path, "staged.txt"), "staged\n");
    gitIn(worktree.path, "add", "staged.txt");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const unstaged = true;\n");
    await writeFile(join(worktree.path, "untracked.txt"), "untracked\n");
    const statusBefore = gitIn(worktree.path, "status", "--porcelain", "--", ":!.devcontainer");
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{ }\n");
    await rm(join(worktree.path, ".devcontainer", "Dockerfile"));
    await writeFile(join(worktree.path, ".devcontainer", "compose.yaml"), "services:\n");
    gitIn(worktree.path, "add", "--all", ".devcontainer");
    await mkdir(join(worktree.path, ".devcontainer", "scripts"));
    await writeFile(join(worktree.path, ".devcontainer", "scripts", "start.sh"), "true\n");

    const paths = await git.restoreFolder(worktree.path, ".devcontainer", serviceVariables);

    expect(paths.toSorted()).toEqual([
      ".devcontainer/Dockerfile",
      ".devcontainer/compose.yaml",
      ".devcontainer/devcontainer.json",
      ".devcontainer/scripts/start.sh",
    ]);
    expect(gitIn(worktree.path, "status", "--porcelain", "--", ".devcontainer")).toBe("");
    await expect(
      readFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "utf8"),
    ).resolves.toBe("{}\n");
    await expect(
      readFile(join(worktree.path, ".devcontainer", "Dockerfile"), "utf8"),
    ).resolves.toBe("FROM node:22\n");
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe(statusBefore);
    expect(gitIn(worktree.path, "diff", "--cached", "--name-only")).toBe("staged.txt");
  });

  it("removes a folder HEAD doesn't have, staged or not, and only it", async () => {
    const worktree = await worktrees.aWorktree();
    await mkdir(join(worktree.path, ".devcontainer"));
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{}\n");
    gitIn(worktree.path, "add", ".devcontainer");
    await writeFile(join(worktree.path, ".devcontainer", "compose.yaml"), "services:\n");
    await writeFile(join(worktree.path, "untracked.txt"), "untracked\n");

    await git.restoreFolder(worktree.path, ".devcontainer", serviceVariables);

    await expect(
      readFile(join(worktree.path, ".devcontainer", "devcontainer.json")),
    ).rejects.toThrow(/ENOENT/);
    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("?? untracked.txt");
    await expect(
      git.restoreFolder(worktree.path, ".devcontainer", serviceVariables),
    ).resolves.toEqual([]);
  });

  it("puts back what a commit refused during a merge wrote, the merge left in progress", async () => {
    const worktree = await worktrees.aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const ours = true;\n");
    gitIn(worktree.path, "commit", "--quiet", "--all", "--message", "Ours");
    gitIn(worktree.path, "checkout", "--quiet", "-b", `${worktree.branch}-theirs`, "HEAD~1");
    await writeFile(join(worktree.path, "src", "index.ts"), "export const theirs = true;\n");
    gitIn(worktree.path, "commit", "--quiet", "--all", "--message", "Theirs");
    gitIn(worktree.path, "checkout", "--quiet", worktree.branch);
    expect(() => gitIn(worktree.path, "merge", "--quiet", `${worktree.branch}-theirs`)).toThrow(
      /Command failed/,
    );
    await mkdir(join(worktree.path, ".devcontainer"));
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{}\n");

    await expect(
      git.commitFolder(worktree.path, ".devcontainer", "Add the definition", serviceVariables),
    ).rejects.toThrow(/partial commit during a merge/);
    await git.restoreFolder(worktree.path, ".devcontainer", serviceVariables);

    expect(gitIn(worktree.path, "status", "--porcelain")).toBe("UU src/index.ts");
  });
});

describe("CommandLineGit.uncommittedPathsUnder", REAL_GIT_TEST, () => {
  it("names the folder's staged, unstaged and untracked paths, and nothing outside it", async () => {
    const worktree = await worktrees.aWorktree();
    await mkdir(join(worktree.path, ".devcontainer"));
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{}\n");
    await writeFile(join(worktree.path, ".devcontainer", "compose.yaml"), "services: {}\n");
    gitIn(worktree.path, "add", ".devcontainer");
    gitIn(worktree.path, "commit", "--quiet", "--message", "Add the definition");
    await expect(
      git.uncommittedPathsUnder(worktree.path, ".devcontainer", serviceVariables),
    ).resolves.toEqual([]);
    await writeFile(join(worktree.path, ".devcontainer", "devcontainer.json"), "{ }\n");
    await writeFile(join(worktree.path, ".devcontainer", "compose.yaml"), "services:\n");
    gitIn(worktree.path, "add", ".devcontainer/compose.yaml");
    await mkdir(join(worktree.path, ".devcontainer", "scripts"));
    await writeFile(join(worktree.path, ".devcontainer", "scripts", "start.sh"), "true\n");
    await writeFile(join(worktree.path, "outside.txt"), "outside\n");

    const paths = await git.uncommittedPathsUnder(worktree.path, ".devcontainer", serviceVariables);

    expect(paths.toSorted()).toEqual([
      ".devcontainer/compose.yaml",
      ".devcontainer/devcontainer.json",
      ".devcontainer/scripts/start.sh",
    ]);
  });
});

describe("CommandLineGit.committedPaths", REAL_GIT_TEST, () => {
  it("gives the paths a commit added, changed and deleted, and both paths of a rename", async () => {
    const worktree = await worktrees.aWorktree();
    await mkdir(join(worktree.path, "docs"));
    await writeFile(join(worktree.path, "README.md"), "# Read me\n");
    await writeFile(join(worktree.path, "docs", "guide.md"), "A guide.\n".repeat(20));
    await git.commit(worktree.path, "Before", serviceVariables);
    await writeFile(join(worktree.path, "src", "index.ts"), "export const changed = true;\n");
    await writeFile(join(worktree.path, "new.txt"), "new\n");
    await rm(join(worktree.path, "README.md"));
    await rename(
      join(worktree.path, "docs", "guide.md"),
      join(worktree.path, "docs", "handbook.md"),
    );
    const commit = await git.commit(worktree.path, "After", serviceVariables);
    if (commit === undefined) throw new Error("The change was committed.");

    const paths = await git.committedPaths(worktree.path, commit);

    expect(paths.toSorted()).toEqual([
      "README.md",
      "docs/guide.md",
      "docs/handbook.md",
      "new.txt",
      "src/index.ts",
    ]);
  });

  it("gives a merge commit's own resolution, not what either branch brought in", async () => {
    const base = await worktrees.aWorktree();
    await writeFile(join(base.path, "from-base.txt"), "base\n");
    await writeFile(join(base.path, "both.txt"), "base\n");
    await git.commit(base.path, "Base", serviceVariables);
    const task = await worktrees.aWorktree();
    await writeFile(join(task.path, "from-task.txt"), "task\n");
    await writeFile(join(task.path, "both.txt"), "task\n");
    await git.commit(task.path, "Task", serviceVariables);
    gitIn(task.path, "merge", "--no-commit", "--no-ff", "--strategy-option=ours", base.branch);
    await writeFile(join(task.path, "both.txt"), "resolved\n");
    await rm(join(task.path, "src", "index.ts"));
    await writeFile(join(task.path, "own.txt"), "own\n");
    const merge = await git.commit(task.path, "Merge", serviceVariables);
    if (merge === undefined) throw new Error("The merge was committed.");

    const paths = await git.committedPaths(task.path, merge);

    expect(paths.toSorted()).toEqual(["both.txt", "own.txt", "src/index.ts"]);
  });

  it("gives nothing for a clean merge", async () => {
    const base = await worktrees.aWorktree();
    await writeFile(join(base.path, "from-base.txt"), "base\n");
    await git.commit(base.path, "Base", serviceVariables);
    const task = await worktrees.aWorktree();
    await writeFile(join(task.path, "from-task.txt"), "task\n");
    await git.commit(task.path, "Task", serviceVariables);
    gitIn(task.path, "merge", "--quiet", "--no-edit", base.branch);

    await expect(
      git.committedPaths(task.path, gitIn(task.path, "rev-parse", "HEAD")),
    ).resolves.toEqual([]);
  });
});
