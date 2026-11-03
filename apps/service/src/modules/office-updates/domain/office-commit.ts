/** A commit of The Office's own git checkout. */
export interface OfficeCommit {
  readonly commit: string;
  readonly subject: string;
  readonly committedAt: Date;
}

const SHORT_COMMIT_LENGTH = 7;

/** The commit as the UI shows The Office's version. */
export function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}
