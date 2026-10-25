import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A git repository in a temp folder, with `main` holding one commit of `src/index.ts`. */
export interface TemporaryRepository {
  /** The temp folder the repository sits in, itself no repository. */
  readonly folder: string;
  readonly path: string;
  remove(): Promise<void>;
}

export async function createTemporaryRepository(): Promise<TemporaryRepository> {
  const folder = await mkdtemp(join(tmpdir(), "office-git-"));
  const path = join(folder, "repository");
  await mkdir(join(path, "src"), { recursive: true });
  await writeFile(join(path, "src", "index.ts"), "export {};\n");
  runGit(path, "init", "--quiet", "--initial-branch", "main");
  runGit(path, "add", ".");
  // An identity of its own: the Linux check's container has none configured.
  runGit(
    path,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    "First commit",
  );
  return { folder, path, remove: () => rm(folder, { recursive: true, force: true }) };
}

function runGit(cwd: string, ...gitArguments: string[]): void {
  execFileSync("git", gitArguments, { cwd, stdio: "ignore" });
}
