/**
 * Sign in with GitHub's user token, for one git command that reaches GitHub over https (spec §5.5
 * Defaults, the Office identity). Bound by the github module once it signs in; while nothing
 * binds it, GitHub over https is reached anonymously, as any other https host.
 */
export abstract class GitHubUserToken {
  /** The token for the command, or undefined while the user is not signed in. */
  abstract forGitCommand(): Promise<string | undefined>;
}
