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
}
