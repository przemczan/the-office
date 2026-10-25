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
    remove: () => rm(folder, { recursive: true, force: true }),
  };
}

function runGit(cwd: string, ...gitArguments: string[]): void {
  execFileSync("git", gitArguments, { cwd, stdio: "ignore" });
}
