import type { GitHubApp } from "../domain/github-app.js";
import type { UserTokens } from "../domain/sign-in.js";

/** A sign-in's code GitHub sent the browser back with, and what proves The Office asked for it. */
export interface SignInCode {
  readonly code: string;
  /** The `redirect_uri` the authorize request named. */
  readonly redirectUri: string;
  /** PKCE's secret, whose SHA-256 the authorize request sent as its `code_challenge`. */
  readonly codeVerifier: string;
}

/**
 * GitHub's answer to a token request: the tokens, or its refusal by its `error` code (such as
 * `bad_verification_code` or `incorrect_client_credentials`), which the application words.
 */
export type TokenAnswer =
  | { readonly kind: "issued"; readonly tokens: UserTokens }
  | { readonly kind: "refused"; readonly error: string };

/** GitHub as The Office calls it. Each call throws `GitHubApiFailure` when GitHub can't be reached. */
export abstract class GitHubApi {
  /**
   * Exchanges the code GitHub redirected back with for the App it registered. Only what
   * `GitHubApp` keeps comes back; the private key and webhook secret in GitHub's answer go no
   * further than the adapter. Also throws `GitHubApiFailure` when GitHub refuses.
   */
  abstract convertManifestCode(code: string): Promise<GitHubApp>;

  /** Exchanges a sign-in's code for the user's tokens, with the App's client secret. */
  abstract exchangeSignInCode(app: GitHubApp, code: SignInCode): Promise<TokenAnswer>;

  /** The login of the user the token belongs to. Also throws `GitHubApiFailure` when GitHub refuses. */
  abstract loginOf(accessToken: string): Promise<string>;
}

/** A call to GitHub that failed, in the UI's words; never holding GitHub's answer, which may carry secrets. */
export class GitHubApiFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubApiFailure";
  }
}
