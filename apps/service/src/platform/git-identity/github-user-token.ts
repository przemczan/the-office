import { GitHubSite } from "./github-site.js";

/**
 * Sign in with GitHub's user token, for one git command that reaches GitHub over https (spec §5.5
 * Defaults, the Office identity), and where that GitHub is. Bound to the github module's access in
 * the composition root; while nothing binds it, GitHub is GitHub's own and its https remotes are
 * reached anonymously, as any other https host's.
 */
export abstract class GitHubUserToken extends GitHubSite {
  /** Whether the user is signed in, without reading or refreshing the token. */
  abstract isSignedIn(): Promise<boolean>;

  /**
   * The token, refreshed first when it is about to expire, or undefined while the user is not
   * signed in. Throws, saying why for the user, when it can't be had.
   */
  abstract userToken(): Promise<string | undefined>;
}
