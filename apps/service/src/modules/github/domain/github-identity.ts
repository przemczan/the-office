/**
 * Who a person is on GitHub, as Continue with GitHub proves it: GitHub's numeric user id, which
 * never changes, as text, and their login, which can, for display only.
 */
export interface GitHubIdentity {
  readonly subject: string;
  readonly name: string;
}

/** Why GitHub didn't say who the person is, in the words the page shows. */
export class GitHubIdentityFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GitHubIdentityFailed";
  }
}
