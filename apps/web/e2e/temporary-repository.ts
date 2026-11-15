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
  // An identity of its own, for The Office's commits in it too (Publish's one commit, a merge):
  // the Linux check's container has none configured.
  runGit(repository, "config", "user.name", "The Office");
  runGit(repository, "config", "user.email", "office@localhost");
  runGit(repository, "add", ".");
  runGit(repository, "commit", "--quiet", "--message", "First commit");
  return {
    folder,
    path: repository,
    // Retries cover a git the service started in it that is still ending on Windows.
    remove: () => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** A temporary repository whose `main` tracks `origin`, a bare repository beside it. */
export interface TemporaryRepositoryWithRemote extends TemporaryRepository {
  /** The bare repository's folder. */
  readonly remote: string;
}

export async function createTemporaryRepositoryWithRemote(): Promise<TemporaryRepositoryWithRemote> {
  const repository = await createTemporaryRepository();
  const remote = path.join(repository.folder, "remote.git");
  runGit(repository.folder, "init", "--quiet", "--bare", "--initial-branch", "main", remote);
  runGit(repository.path, "remote", "add", "origin", remote);
  runGit(repository.path, "push", "--quiet", "--set-upstream", "origin", "main");
  return { ...repository, remote };
}

/** The file as `branch` of the bare remote holds it; undefined when it holds none. */
export function fileOnRemote(
  repository: TemporaryRepositoryWithRemote,
  branch: string,
  file: string,
): string | undefined {
  try {
    return execFileSync("git", ["show", `${branch}:${file}`], {
      cwd: repository.remote,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/** Commits `files`, by their paths in the repository, on the branch checked out. */
export async function commitFiles(
  repository: TemporaryRepository,
  files: Readonly<Record<string, string | Buffer>>,
): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(repository.path, file);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  runGit(repository.path, "add", ".");
  runGit(
    repository.path,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    "Commit files",
  );
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
