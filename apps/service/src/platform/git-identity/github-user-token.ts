/**
 * Sign in with GitHub's user token, for one git command that reaches GitHub over https (spec §5.5
 * Defaults, the Office identity). Bound to the github module's access in the composition root;
 * while nothing binds it, GitHub over https is reached anonymously, as any other https host.
 */
export abstract class GitHubUserToken {
  /** GitHub's website, whose https remotes the token is for, such as `https://github.com`. */
  abstract readonly webUrl: string;

  /** Whether the user is signed in, without reading or refreshing the token. */
  abstract isSignedIn(): Promise<boolean>;

  /**
   * The token, refreshed first when it is about to expire, or undefined while the user is not
   * signed in. Throws, saying why for the user, when it can't be had.
   */
  abstract userToken(): Promise<string | undefined>;
}
