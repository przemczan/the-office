import type { SignInWay, SignInWayKind, UnavailableWay } from "@the-office/contracts";
import { Fragment, type ReactNode } from "react";
import {
  elsewhereHref,
  elsewhereWords,
  passkeysUnavailableWords,
} from "../../shell/passkey-words.ts";
import { googleUnavailableWords } from "../../shell/google-words.ts";
import { GitHubWay } from "./github-way.tsx";
import { GoogleWay } from "./google-way.tsx";
import { PasskeyWay } from "./passkey-way.tsx";
import { PasswordWay } from "./password-way.tsx";

/** What draws one kind of way to sign in, given that way as the service listed it. */
export type SignInWayView<Kind extends SignInWayKind> = (props: {
  readonly way: Extract<SignInWay, { readonly kind: Kind }>;
}) => ReactNode;

/**
 * Each way to sign in by its kind. Every kind the contract's union has needs its entry, so a way a
 * later Task adds can't be left undrawn.
 */
export const SIGN_IN_WAYS: { readonly [Kind in SignInWayKind]: SignInWayView<Kind> } = {
  password: PasswordWay,
  passkey: PasskeyWay,
  github: GitHubWay,
  google: GoogleWay,
};

/**
 * Why a way set up doesn't work at this address, by its kind; a password works everywhere. Later
 * ways that depend on the address add their words here.
 */
const UNAVAILABLE_WORDS: { readonly [Kind in SignInWayKind]: (way: UnavailableWay) => string } = {
  password: () => "Signing in with a password doesn't work at this address.",
  passkey: (way) => passkeysUnavailableWords(way.reason),
  // GitHub sends the browser back to any callback URL the App lists, so it works at every address.
  github: () => "Continue with GitHub doesn't work at this address.",
  google: (way) => googleUnavailableWords(way.reason),
};

/**
 * The ways the service listed for this address, each drawn by its kind, in the service's order,
 * "or" between them, then why the others don't work here, each with where they do.
 */
export function SignInWays({
  ways,
  unavailable,
}: {
  readonly ways: readonly SignInWay[];
  readonly unavailable: readonly UnavailableWay[];
}): ReactNode {
  return (
    <>
      {ways.map((way, index) => (
        <Fragment key={way.kind}>
          {index > 0 && (
            <div className="sign-in-or" role="separator">
              or
            </div>
          )}
          {wayView(way)}
        </Fragment>
      ))}
      {unavailable.map((way) => (
        <p key={way.kind} className="sign-in-quiet">
          {UNAVAILABLE_WORDS[way.kind](way)}{" "}
          {way.elsewhere !== undefined && (
            <a href={elsewhereHref(way.elsewhere, "/sign-in")}>{elsewhereWords(way.elsewhere)}</a>
          )}
        </p>
      ))}
    </>
  );
}

function wayView<Kind extends SignInWayKind>(
  way: Extract<SignInWay, { readonly kind: Kind }>,
): ReactNode {
  const View = SIGN_IN_WAYS[way.kind as Kind] as SignInWayView<Kind>;
  return <View way={way} />;
}
