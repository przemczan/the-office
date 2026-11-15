import type { PublishedRelease } from "../domain/published-release.js";

/** The Office's published releases (docs/releasing.md), on GitHub Releases. */
export abstract class OfficeReleases {
  /**
   * The releases of `repository` (`owner/name`) newer than `version`, newest first, never a draft
   * or a pre-release. Throws when they can't be read.
   */
  abstract newerThan(repository: string, version: string): Promise<PublishedRelease[]>;
}
