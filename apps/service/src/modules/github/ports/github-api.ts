import type { GitHubApp } from "../domain/github-app.js";

/** GitHub as The Office calls it. */
export abstract class GitHubApi {
  /**
   * Exchanges the code GitHub redirected back with for the App it registered. Only what
   * `GitHubApp` keeps comes back; the secrets in GitHub's answer go no further than the adapter.
   * Throws `GitHubApiFailure` when GitHub refuses or can't be reached.
   */
  abstract convertManifestCode(code: string): Promise<GitHubApp>;
}

/** A call to GitHub that failed, in the UI's words; never holding GitHub's answer, which may carry secrets. */
export class GitHubApiFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubApiFailure";
  }
}
