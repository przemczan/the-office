// Reads a push's commits and the newest release from the repository's history with git.
import { execFileSync, spawnSync } from "node:child_process";
import type { Commit, Release } from "./commits-to-check.ts";

/** What GitHub sends as a push's `before` when the push creates the branch. */
const NO_COMMIT = /^0+$/;
const FIELD = "\x00";
const RECORD = "\x1e";

/** The commits `from` (exclusive) to `to`, oldest first; every commit up to `to` when the push created the branch. */
export function commitsBetween(repository: string, from: string, to: string): Commit[] {
  const range = NO_COMMIT.test(from) ? [to] : [`${from}..${to}`];
  const log = git(repository, [
    "log",
    "--topo-order",
    "--reverse",
    // git writes the separators itself: a process argument can't hold a null byte.
    "--format=%H%x00%P%x00%B%x1e",
    ...range,
  ]);
  return log
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => {
      const [sha = "", parents = "", message = ""] = record.split(FIELD);
      return { sha, parents: parents === "" ? [] : parents.split(" "), message: message.trimEnd() };
    });
}

/** The newest `v*` tag `to` reaches, with the commits it reaches; undefined before the first release. */
export function newestRelease(repository: string, to: string): Release | undefined {
  const describe = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", to], {
    cwd: repository,
    encoding: "utf8",
  });
  if (describe.status !== 0) return undefined;
  const tag = describe.stdout.trim();
  const commits = git(repository, ["rev-list", `${tag}^{commit}`])
    .split("\n")
    .filter(Boolean);
  return { tag, commits: new Set(commits) };
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}
