import { nameFromFileName } from "./skill-draft.js";
import { skillFilePathProblem } from "./skill-files.js";

/**
 * The release of its Source an installed skill is held at: the Source's newest tag, or its
 * default branch's newest commit when it has no tags (spec §2.6).
 */
export interface PinnedVersion {
  /** Absent when the Source has no tags. */
  readonly tag?: string;
  readonly commit: string;
}

/** Where an installed skill comes from: its Source's repository and folder, and its pinned version. */
export interface InstalledSource {
  /** As given: `owner/repo` on GitHub, or a git URL. */
  readonly repository: string;
  /** The skill's folder in the repository, with `/` between folders; empty for the top folder. */
  readonly folder: string;
  readonly pinnedVersion: PinnedVersion;
}

/** A ref a Source's repository advertises, as `git ls-remote` lists it. */
export interface RemoteRef {
  /** Such as `HEAD`, `refs/tags/v1.0` or `refs/tags/v1.0^{}`, the commit an annotated tag points at. */
  readonly name: string;
  readonly commit: string;
}

const GITHUB_REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*)\/[A-Za-z0-9._-]+$/;
/** The transports a Source may use; others, such as `ext::`, could run commands. */
const GIT_URL = /^(?:https:\/\/|ssh:\/\/|file:\/\/|git@[A-Za-z0-9.-]+:)\S+$/;
const TAG_PREFIX = "refs/tags/";
const PEELED = "^{}";

/** Why `repository` can't be a Source, in the UI's words; empty when it can. */
export function sourceRepositoryProblems(repository: string): string[] {
  if (repository === "") return ["Give a source: owner/repo or a git URL."];
  if (GITHUB_REPOSITORY.test(repository) && !repository.split("/").includes("..")) return [];
  if (GIT_URL.test(repository)) return [];
  return [
    `"${repository}" is no source: give owner/repo on GitHub, or a git URL starting with https://, ssh://, git@ or file://.`,
  ];
}

/** The URL git fetches a Source from: `owner/repo` is on GitHub. Expects a repository without problems. */
export function sourceUrl(repository: string): string {
  if (!GITHUB_REPOSITORY.test(repository)) return repository;
  return `https://github.com/${repository.replace(/\.git$/, "")}.git`;
}

/** Why `folder` can't be a skill's folder in a Source; undefined when it can. */
export function sourceFolderProblem(folder: string): string | undefined {
  if (folder === "") return undefined;
  return skillFilePathProblem(folder) === undefined
    ? undefined
    : `"${folder}" is no folder inside the source.`;
}

/**
 * The name a skill gets when its SKILL.md names none, as the engine names a skill by its folder:
 * the folder's own name, or the repository's for its top folder.
 */
export function fallbackNameOf(source: Pick<InstalledSource, "repository" | "folder">): string {
  const named = source.folder === "" ? source.repository.replace(/\/+$/, "") : source.folder;
  const last = named.split(/[/:]/).pop() ?? "";
  return nameFromFileName(last.replace(/\.git$/, ""));
}

/** The pinned version a Source's refs give, or undefined when it has no commits at all. */
export function pinnedVersionOf(refs: readonly RemoteRef[]): PinnedVersion | undefined {
  const tags = tagsOf(refs);
  const newest = tags.toSorted((first, second) => compareTags(second.tag, first.tag))[0];
  if (newest) return newest;
  const head = refs.find((ref) => ref.name === "HEAD");
  return head && { commit: head.commit };
}

/** How a pinned version reads in the UI: its tag, or its commit's first characters. */
export function pinnedVersionLabel(pinnedVersion: PinnedVersion): string {
  return pinnedVersion.tag ?? pinnedVersion.commit.slice(0, 7);
}

/**
 * Whether the Source's pinned version now is an update of `pinned`: another commit with a newer
 * tag, or any other commit when `pinned` has no tag. A deleted tag, or a tag moved to another
 * commit, is none: only a newer release is offered.
 */
export function isUpdateOf(now: PinnedVersion, pinned: PinnedVersion): boolean {
  if (now.commit === pinned.commit) return false;
  if (pinned.tag === undefined) return true;
  return now.tag !== undefined && compareTags(now.tag, pinned.tag) > 0;
}

export function samePinnedVersion(first: PinnedVersion, second: PinnedVersion): boolean {
  return first.tag === second.tag && first.commit === second.commit;
}

/** Each tag with the commit it points at, peeling annotated tags. */
function tagsOf(refs: readonly RemoteRef[]): { tag: string; commit: string }[] {
  const commits = new Map<string, string>();
  for (const ref of refs) {
    if (!ref.name.startsWith(TAG_PREFIX)) continue;
    const peeled = ref.name.endsWith(PEELED);
    const tag = ref.name.slice(TAG_PREFIX.length, peeled ? -PEELED.length : undefined);
    if (peeled || !commits.has(tag)) commits.set(tag, ref.commit);
  }
  return [...commits].map(([tag, commit]) => ({ tag, commit }));
}

const NUMERIC = new Intl.Collator("en", { numeric: true });

/**
 * Orders tags as versions, so v1.10 is newer than v1.9, and a release newer than its own
 * pre-releases (v2.0.0 after v2.0.0-beta). Ties of equal text keep the plain comparison.
 */
export function compareTags(first: string, second: string): number {
  const [firstRelease = "", ...firstSuffix] = first.split("-");
  const [secondRelease = "", ...secondSuffix] = second.split("-");
  const byRelease = NUMERIC.compare(firstRelease, secondRelease);
  if (byRelease !== 0) return byRelease;
  if (firstSuffix.length === 0 || secondSuffix.length === 0) {
    return secondSuffix.length - firstSuffix.length;
  }
  return NUMERIC.compare(firstSuffix.join("-"), secondSuffix.join("-"));
}
