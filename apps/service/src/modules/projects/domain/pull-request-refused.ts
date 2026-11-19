/**
 * A merge or close of a pull request The Office or its code host refused: `reason` in plain words,
 * quoting the host's own message, and `refresh` true when the pull request changed since The
 * Office last read it, so a refresh may let it through.
 */
export class PullRequestRefused extends Error {
  constructor(
    readonly reason: string,
    readonly refresh: boolean,
  ) {
    super(reason);
    this.name = "PullRequestRefused";
  }
}

export class PullRequestNotFound extends Error {
  constructor(readonly pullRequestId: string) {
    super(`There is no pull request "${pullRequestId}".`);
    this.name = "PullRequestNotFound";
  }
}
