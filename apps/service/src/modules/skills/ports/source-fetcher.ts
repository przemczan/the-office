import type { PinnedVersion, RemoteRef } from "../domain/installed-source.js";
import type { SourceFolder } from "../domain/source-skills.js";

/** A Source that could not be reached or read, in git's own words. */
export class SourceNotFetched extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "SourceNotFetched";
  }
}

/** What to read of a Source at a pinned version. */
export interface SourceRead {
  /** The URL git fetches from (`sourceUrl`). */
  readonly url: string;
  readonly pinnedVersion: PinnedVersion;
  /** Only this skill folder; every one when absent. */
  readonly folder?: string;
  /** A folder holding more is marked too large and its files are not read. */
  readonly limits: { readonly files: number; readonly bytes: number };
}

/** What to compare of a Source: a skill's folder between two pinned versions. */
export interface SourceDiffRead {
  readonly url: string;
  /** The skill's folder; empty for the top folder. */
  readonly folder: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
}

/**
 * Reads Sources: the git repositories skills are installed from. Every call reaches the network.
 * Throws SourceNotFetched.
 */
export abstract class SourceFetcher {
  /** The refs the Source advertises: its HEAD and its tags. */
  abstract refs(url: string): Promise<readonly RemoteRef[]>;

  /**
   * The folders holding a SKILL.md at the pinned version, with their files. Refuses when a pinned
   * tag no longer points at the pinned commit.
   */
  abstract skillFolders(read: SourceRead): Promise<readonly SourceFolder[]>;

  /**
   * The unified diff of the folder from one pinned version to the other, its paths inside the
   * folder. Refuses as `skillFolders` does when a pinned tag moved.
   */
  abstract diff(read: SourceDiffRead): Promise<string>;
}
