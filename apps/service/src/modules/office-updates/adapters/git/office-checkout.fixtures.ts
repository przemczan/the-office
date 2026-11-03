import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** A checkout of The Office for tests: a clone of a local bare upstream, which can move ahead. */
export interface OfficeCheckoutForTests {
  /** The clone the service would run from. */
  readonly path: string;
  readonly upstream: string;
  /** Commits on the upstream from another clone, so the checkout falls behind; their commits. */
  pushNewer(...subjects: string[]): Promise<string[]>;
  /** Commits in the checkout alone, so it has what its upstream doesn't. */
  commitLocally(subject: string): Promise<void>;
  /** Changes a tracked file without committing it. */
  changeLocally(): Promise<void>;
  head(): Promise<string>;
}

export async function createOfficeCheckout(folder: string): Promise<OfficeCheckoutForTests> {
  const upstream = join(folder, "upstream.git");
  const path = join(folder, "checkout");
  const other = join(folder, "other");
  await mkdir(folder, { recursive: true });
  await git(folder, "init", "--quiet", "--bare", "--initial-branch=main", upstream);
  await git(folder, "clone", "--quiet", upstream, path);
  await commit(path, "The first version");
  await git(path, "push", "--quiet", "--set-upstream", "origin", "main");
  await git(folder, "clone", "--quiet", upstream, other);
  return {
    path,
    upstream,
    async pushNewer(...subjects) {
      await git(other, "pull", "--quiet", "--ff-only");
      const commits: string[] = [];
      for (const subject of subjects) {
        await commit(other, subject);
        commits.push(await headOf(other));
      }
      await git(other, "push", "--quiet");
      return commits;
    },
    commitLocally: (subject) => commit(path, subject),
    changeLocally: () => writeFile(join(path, "version.txt"), "changed by hand\n"),
    head: () => headOf(path),
  };
}

async function commit(repository: string, subject: string): Promise<void> {
  await writeFile(join(repository, "version.txt"), `${subject}\n`);
  await git(repository, "add", "version.txt");
  await git(repository, "commit", "--quiet", "-m", subject);
}

async function headOf(repository: string): Promise<string> {
  return (await git(repository, "rev-parse", "HEAD")).trim();
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];
  return (await run("git", [...identity, ...args], { cwd })).stdout;
}
