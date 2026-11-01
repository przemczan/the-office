/**
 * The user token and its refresh token, as GitHub hands them out. The expiries are absolute,
 * worked out when GitHub answered; each is undefined when that token doesn't expire.
 */
export interface UserTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date | undefined;
  readonly refreshToken: string | undefined;
  readonly refreshTokenExpiresAt: Date | undefined;
}

/** Why The Office signed the user out, in the words Settings › Office identity shows. */
export interface SignedOutReason {
  readonly text: string;
}

/**
 * What The Office keeps of Sign in with GitHub: who is signed in with which tokens, or why The
 * Office signed the user out. Nothing kept means signed out by the user, or never signed in.
 */
export type KeptSignIn =
  | { readonly status: "signed-in"; readonly login: string; readonly tokens: UserTokens }
  | { readonly status: "signed-out"; readonly reason: SignedOutReason };

/** Why signing in failed, in the words Settings › Office identity shows. */
export class GitHubSignInFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GitHubSignInFailed";
  }
}
