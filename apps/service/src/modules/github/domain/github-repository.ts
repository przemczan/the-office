/** A repository the GitHub App is installed on that the signed-in user can reach. */
export interface GitHubRepository {
  /** `owner/name`. */
  readonly fullName: string;
  /** Its https Repository URL, to clone it by. */
  readonly repositoryUrl: string;
  readonly private: boolean;
  readonly defaultBranch: string;
}

/** Why GitHub couldn't be used for the user, in the words the UI shows. */
export class GitHubAccessFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GitHubAccessFailed";
  }
}

/** The user isn't signed in with GitHub, so nothing can be asked of GitHub as them. */
export class NotSignedInWithGitHub extends Error {
  constructor() {
    super("Sign in with GitHub first, in Settings › Office identity.");
    this.name = "NotSignedInWithGitHub";
  }
}
