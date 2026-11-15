// Which commits count for an Office release (docs/releasing.md). Before the first v* tag, main's
// history holds hundreds of commits from before releases, many of them `feat:` and `fix:`; only
// the commits made after the one that added the release config count, so the first release's
// version and notes come from those alone. Once a release is tagged, every commit since counts.
import { execFileSync } from "node:child_process";

/** semantic-release's config, whose adding commit starts the release history. */
export const RELEASE_CONFIG = ".releaserc.json";

/** A commit as semantic-release hands it to its plugins; only its hash matters here. */
export interface Commit {
  readonly hash: string;
}

export interface ReleaseHistory {
  /** The last release's tag; undefined before the first release. */
  readonly lastReleaseTag: string | undefined;
  /** The repository's folder. */
  readonly cwd: string;
}

/** The commits of `commits` that count for the next release. */
export function releaseCommits<C extends Commit>(
  commits: readonly C[],
  history: ReleaseHistory,
): C[] {
  if (history.lastReleaseTag) return [...commits];
  const counted = commitsAfterReleaseStart(history.cwd);
  return commits.filter(({ hash }) => counted.has(hash));
}

/**
 * The commits that descend from the commit that added RELEASE_CONFIG, up to HEAD: a commit merged
 * in from history older than it doesn't descend from it, so it doesn't count.
 */
function commitsAfterReleaseStart(cwd: string): Set<string> {
  const [start] = git(cwd, [
    "log",
    "--diff-filter=A",
    "--reverse",
    "--format=%H",
    "--",
    RELEASE_CONFIG,
  ]);
  if (!start) throw new Error(`No commit in HEAD's history adds ${RELEASE_CONFIG}.`);
  return new Set(git(cwd, ["rev-list", "--ancestry-path", `${start}..HEAD`]));
}

function git(cwd: string, args: readonly string[]): string[] {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
}
