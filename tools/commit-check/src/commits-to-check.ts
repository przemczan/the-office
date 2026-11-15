export interface Commit {
  sha: string;
  parents: readonly string[];
  message: string;
}

/** The newest `v*` tag and every commit reachable from it, which shipped in a release or before. */
export interface Release {
  tag: string;
  commits: ReadonlySet<string>;
}

export type CommitsToCheck =
  { commits: readonly Commit[]; after: string } | { commits: readonly []; reason: string };

export const NO_RELEASE_YET = "no release yet; the check starts with the first release";

/**
 * The commits of a push that must be Conventional Commits: those after the newest release, merges
 * left out. The commits before the first release keep the style they were written in.
 */
export function commitsToCheck(
  range: readonly Commit[],
  release: Release | undefined,
): CommitsToCheck {
  if (release === undefined) return { commits: [], reason: NO_RELEASE_YET };
  return {
    commits: range.filter(
      (commit) => commit.parents.length <= 1 && !release.commits.has(commit.sha),
    ),
    after: release.tag,
  };
}

export function subjectOf(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}
