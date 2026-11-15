import { shortCommit, type OfficeCommit } from "./office-commit.js";

/** An Office release (docs/releasing.md): the version The Office runs as, and its commit. */
export interface OfficeRelease {
  readonly version: string;
  readonly commit: OfficeCommit;
  /** The GitHub repository it is released from, as `owner/name`; absent from older stamps. */
  readonly repository: string | undefined;
}

/** The release as the service's log names it at boot. */
export function releaseWords({ version, commit }: OfficeRelease): string {
  return `The Office ${version} (${shortCommit(commit.commit)})`;
}
