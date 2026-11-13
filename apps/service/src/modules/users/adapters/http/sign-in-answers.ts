import type { SignInOutcome as SignInOutcomeMessage } from "@the-office/contracts";
import type { Response } from "express";
import type { SignInOutcome } from "../../application/sign-ins.js";
import { clearedPendingSignInCookie, pendingSignInCookie, signInCookie } from "./sign-in-cookie.js";

/** Where the web asks for the authenticator code. */
const CODE_PAGE = "/sign-in/code";

/**
 * Answers a sign-in in the body, as the sign-in page's own requests read it: signed in, with the
 * sign-in cookie and the pending one cleared, or waiting for the code, with the pending cookie. The
 * tokens travel only in cookies, never in the body.
 */
export function answerSignIn(
  outcome: SignInOutcome,
  secure: boolean,
  response: Response,
): SignInOutcomeMessage {
  response.setHeader("Set-Cookie", cookiesOf(outcome, secure));
  return { outcome: outcome.outcome };
}

/**
 * Answers a sign-in by sending the browser on, as a way's callback does (Continue with GitHub and
 * Continue with Google): to `returnTo` once signed in, or to the code page, which goes on to it.
 */
export function redirectSignIn(
  outcome: SignInOutcome,
  secure: boolean,
  returnTo: string,
  response: Response,
): void {
  const next = samePagePath(returnTo);
  response.setHeader("Set-Cookie", cookiesOf(outcome, secure));
  response.redirect(
    303,
    outcome.outcome === "signed-in" ? next : `${CODE_PAGE}?returnTo=${encodeURIComponent(next)}`,
  );
}

function cookiesOf(outcome: SignInOutcome, secure: boolean): string[] {
  return outcome.outcome === "signed-in"
    ? [signInCookie(outcome.token, secure), clearedPendingSignInCookie(secure)]
    : [pendingSignInCookie(outcome.pendingToken, secure)];
}

/** A path on this site only, so no callback sends the browser to another one. */
function samePagePath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}
