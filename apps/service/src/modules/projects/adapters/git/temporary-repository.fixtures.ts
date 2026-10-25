import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A git repository in a temp folder, with `main` holding one commit of `src/index.ts`, and a bare
 * repository beside it as its `origin`, holding the same `main`.
 */
export interface TemporaryRepository {
  /** The temp folder both repositories sit in, itself no repository. */
  readonly folder: string;
  readonly path: string;
  readonly originPath: string;
  remove(): Promise<void>;
}

export async function createTemporaryRepository(): Promise<TemporaryRepository> {
  const folder = await mkdtemp(join(tmpdir(), "office-git-"));
  const path = join(folder, "repository");
  const originPath = join(folder, "origin.git");
  await mkdir(join(path, "src"), { recursive: true });
  await writeFile(join(path, "src", "index.ts"), "export {};\n");
  gitIn(path, "init", "--quiet", "--initial-branch", "main");
  // An identity of its own, as the Linux check's container has none, and files kept as written.
  gitIn(path, "config", "user.name", "The Office");
  gitIn(path, "config", "user.email", "office@localhost");
  gitIn(path, "config", "core.autocrlf", "false");
  gitIn(path, "add", ".");
  gitIn(path, "commit", "--quiet", "--message", "First commit");
  gitIn(folder, "clone", "--quiet", "--bare", path, originPath);
  gitIn(path, "remote", "add", "origin", originPath);
  return { folder, path, originPath, remove: () => rm(folder, { recursive: true, force: true }) };
}

/** Runs git in `cwd` and returns what it printed, trimmed. */
export function gitIn(cwd: string, ...gitArguments: string[]): string {
  return execFileSync("git", gitArguments, { cwd, encoding: "utf8" }).trim();
}

/**
 * Commits `file` on `branch` in the origin, through a clone of its own, as someone else would,
 * and returns the commit.
 */
export async function commitOnOrigin(
  repository: TemporaryRepository,
  branch: string,
  file: string,
): Promise<string> {
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
