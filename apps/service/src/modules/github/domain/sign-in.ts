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

/**
 * How long before the user token expires The Office refreshes it. git asks for the token once per
 * command and keeps using it, so the margin covers a long clone.
 */
const REFRESH_MARGIN_MS = 15 * 60 * 1000;

/** Whether the user token expires within the margin, so it is refreshed before use. */
export function needsRefresh(tokens: UserTokens, now: Date): boolean {
  const expiresAt = tokens.accessTokenExpiresAt;
  return expiresAt !== undefined && expiresAt.getTime() - REFRESH_MARGIN_MS <= now.getTime();
}

/** The refresh token, while it still works; GitHub's last six months after it was handed out. */
export function usableRefreshToken(tokens: UserTokens, now: Date): string | undefined {
  const expiresAt = tokens.refreshTokenExpiresAt;
  if (expiresAt !== undefined && expiresAt.getTime() <= now.getTime()) return undefined;
  return tokens.refreshToken;
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
