import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitVariables, NewWorktree } from "../../ports/git.js";
import type { CommandLineGit } from "./command-line-git.js";
import type { TemporaryRepository } from "./temporary-repository.fixtures.js";

/** The service's own environment, as a Project's variables. */
export const serviceVariables: GitVariables = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

/** Makes worktrees of one temporary repository, each at a path unlike any other in the file. */
export class WorktreeMaker {
  private made = 0;

  constructor(
    private readonly git: CommandLineGit,
    private readonly repository: TemporaryRepository,
  ) {}

  /** How many worktree paths it has given; part of each path, so a name built on it is unique too. */
  get count(): number {
    return this.made;
  }

  /** A path for a new worktree. */
  aPath(): string {
    this.made += 1;
    return join(this.repository.folder, "worktrees", `worktree-${this.made}`);
  }

  detachedAtMain(): NewWorktree {
    return { path: this.aPath(), checkout: { kind: "detached", startPoint: "main" } };
  }

  /** A worktree on a new branch at `main`. */
  async aWorktree(): Promise<{ path: string; branch: string }> {
    const path = this.aPath();
    const branch = `office/task-${this.made}`;
    await this.git.addWorktree(
      this.repository.path,
      { path, checkout: { kind: "new-branch", branch, startPoint: "main" } },
      serviceVariables,
    );
    return { path, branch };
  }
}

export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

/**
 * Makes, for `worktrees()`' repository, a worktree whose branch changes `src/index.ts`, and a
 * commit beside it that moved on from main.
 */
export function movedMainMaker(
  git: CommandLineGit,
  worktrees: () => WorktreeMaker,
): (mainContent: string) => Promise<{ path: string; branch: string; main: string }> {
  return async (mainContent) => {
    const worktree = await worktrees().aWorktree();
    await writeFile(join(worktree.path, "src", "index.ts"), "export const task = 1;\n");
    await git.commit(worktree.path, "Change index.ts", serviceVariables);
    const moved = await worktrees().aWorktree();
    await writeFile(join(moved.path, "src", "index.ts"), mainContent);
    await writeFile(join(moved.path, `elsewhere-${worktrees().count}.txt`), "elsewhere\n");
    const main = await git.commit(moved.path, "Move main on", serviceVariables);
    if (!main) throw new Error("The moved branch committed nothing.");
    return { path: worktree.path, branch: worktree.branch, main };
  };
}
