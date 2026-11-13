import type { SignInOutcome as SignInOutcomeMessage } from "@the-office/contracts";
import type { Response } from "express";
import type { SignInOutcome } from "../../application/sign-ins.js";
import { signInCookie } from "./sign-in-cookie.js";

/**
 * The outcome as the web reads it; signed in, the cookie carries the token, never the body.
 * `otherCookies` are set along with it, such as a finished ceremony's cookie forgotten.
 */
export function answered(
  outcome: SignInOutcome,
  secure: boolean,
  response: Response,
  otherCookies: readonly string[] = [],
): SignInOutcomeMessage {
  const cookies = [
    ...(outcome.outcome === "signed-in" ? [signInCookie(outcome.token, secure)] : []),
    ...otherCookies,
  ];
  if (cookies.length === 1) response.setHeader("Set-Cookie", cookies[0] ?? "");
  else if (cookies.length > 1) response.setHeader("Set-Cookie", cookies);
  return { outcome: outcome.outcome };
}
