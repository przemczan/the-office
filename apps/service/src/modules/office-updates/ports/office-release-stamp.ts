import type { OfficeRelease } from "../domain/office-release.js";

/**
 * The stamp an Office release carries (`office-release.json`, written by `tools/release`): which
 * version and commit its files are. A checkout has none.
 */
export abstract class OfficeReleaseStamp {
  /** The release The Office runs as; undefined when it runs from a checkout. */
  abstract read(): Promise<OfficeRelease | undefined>;
}
