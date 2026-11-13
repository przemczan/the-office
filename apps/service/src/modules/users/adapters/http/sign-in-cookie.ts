import { PENDING_SIGN_IN_SECONDS } from "../../domain/pending-sign-in.js";

/** The cookie that keeps a browser signed in, its value the signed-in device's token. */
export const SIGN_IN_COOKIE = "office_signed_in";

/**
 * The cookie of a sign-in waiting for the authenticator code, its value the pending sign-in's
 * token. Sent only to the sign-in paths, so no other request carries it, and the guard never reads
 * it.
 */
export const PENDING_SIGN_IN_COOKIE = "office_pending_sign_in";
const PENDING_SIGN_IN_PATH = "/api/sign-in";

/**
 * How long the browser keeps it: its longest, 400 days, as browsers cap it. The service ends a
 * device 30 days after its last use (spec §2.10 Defaults), whatever the cookie says.
 */
const KEPT_SECONDS = 400 * 24 * 60 * 60;

/**
 * The Set-Cookie header that signs this browser in (spec §2.10): HttpOnly, so no script reads it;
 * SameSite=Lax, so GitHub's and Google's redirects back carry it; Path=/; and Secure when the page
 * came through the public address over HTTPS.
 */
export function signInCookie(token: string, secure: boolean): string {
  return cookie(SIGN_IN_COOKIE, token, "/", KEPT_SECONDS, secure);
}

/** The Set-Cookie header that makes the browser forget it. */
export function clearedSignInCookie(secure: boolean): string {
  return cookie(SIGN_IN_COOKIE, "", "/", 0, secure);
}

/** The Set-Cookie header of a pending sign-in, kept as long as it waits. */
export function pendingSignInCookie(token: string, secure: boolean): string {
  return cookie(
    PENDING_SIGN_IN_COOKIE,
    token,
    PENDING_SIGN_IN_PATH,
    PENDING_SIGN_IN_SECONDS,
    secure,
  );
}

export function clearedPendingSignInCookie(secure: boolean): string {
  return cookie(PENDING_SIGN_IN_COOKIE, "", PENDING_SIGN_IN_PATH, 0, secure);
}

function cookie(
  name: string,
  value: string,
  path: string,
  maxAge: number,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** The sign-in token a Cookie header carries, or undefined when it has none. */
export function signInTokenOf(cookieHeader: string | undefined): string | undefined {
  return cookieValueOf(cookieHeader, SIGN_IN_COOKIE);
}

/** The pending sign-in's token a Cookie header carries, or undefined when it has none. */
export function pendingSignInTokenOf(cookieHeader: string | undefined): string | undefined {
  return cookieValueOf(cookieHeader, PENDING_SIGN_IN_COOKIE);
}

/** The value of the cookie of this name a Cookie header carries, or undefined when it has none. */
export function cookieValueOf(cookieHeader: string | undefined, name: string): string | undefined {
  for (const pair of (cookieHeader ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}
