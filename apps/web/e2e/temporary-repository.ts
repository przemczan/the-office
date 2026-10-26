import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A git repository in a temp folder, with `main` holding one commit. */
export interface TemporaryRepository {
  /** The temp folder the repository sits in, itself no repository. */
  readonly folder: string;
  readonly path: string;
  remove(): Promise<void>;
}

export async function createTemporaryRepository(): Promise<TemporaryRepository> {
  const folder = await mkdtemp(path.join(tmpdir(), "office-e2e-"));
  const repository = path.join(folder, "admin-panel");
  await mkdir(repository);
  await writeFile(path.join(repository, "README.md"), "# Admin panel\n");
  runGit(repository, "init", "--quiet", "--initial-branch", "main");
  runGit(repository, "add", ".");
  // An identity of its own: the Linux check's container has none configured.
  runGit(
    repository,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    "First commit",
  );
  return {
    folder,
    path: repository,
    // Retries cover a git the service started in it that is still ending on Windows.
    remove: () => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/**
 * Commits a file on a Task's branch, as a Stage's work would be, through a worktree removed
 * afterwards, so only the branch stays.
 */
export async function commitOnTaskBranch(
  repository: TemporaryRepository,
  taskId: string,
  file: string,
  content: string,
): Promise<void> {
  const worktree = path.join(repository.folder, `task-${taskId}`);
  runGit(repository.path, "worktree", "add", "--quiet", "-b", `office/${taskId}`, worktree, "main");
  await writeFile(path.join(worktree, file), content);
  runGit(worktree, "add", ".");
  runGit(
    worktree,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    `Implement: ${file}`,
  );
  runGit(repository.path, "worktree", "remove", "--force", worktree);
}

/** Checks the Task's branch out where The Office keeps its worktree, as Start would. */
export function addTaskWorktree(
  repository: TemporaryRepository,
  taskId: string,
  worktreePath: string,
): void {
  runGit(repository.path, "worktree", "add", "--quiet", worktreePath, `office/${taskId}`);
}

function runGit(cwd: string, ...gitArguments: string[]): void {
  execFileSync("git", gitArguments, { cwd, stdio: "ignore" });
}
