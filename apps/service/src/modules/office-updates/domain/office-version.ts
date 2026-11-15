import { shortCommit } from "./office-commit.js";

/** A released version of The Office, as semver's major.minor.patch; pre-releases are never one. */
export interface OfficeVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The version `1.2.3` or a tag `v1.2.3` names; undefined for anything else, pre-releases included. */
export function parseVersion(text: string): OfficeVersion | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) return undefined;
  const [, major = "", minor = "", patch = ""] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** Negative when `a` is older than `b`, positive when newer, 0 when they are the same. */
export function compareVersions(a: OfficeVersion, b: OfficeVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isNewer(candidate: OfficeVersion, than: OfficeVersion): boolean {
  return compareVersions(candidate, than) > 0;
}

export function versionText({ major, minor, patch }: OfficeVersion): string {
  return `${major}.${minor}.${patch}`;
}

/**
 * What an update went from or to, as the UI names it: a commit shortened, a version whole, as a
 * checkout's update names commits and a release's or a container's names versions.
 */
export function officeVersionWords(ref: string): string {
  return parseVersion(ref) ? ref : shortCommit(ref);
}
