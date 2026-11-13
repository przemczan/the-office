import { queryOptions } from "@tanstack/react-query";
import {
  accountSchema,
  authenticatorSetupSchema,
  recoveryCodesSchema,
  signedInDeviceListSchema,
  signInOutcomeSchema,
  signInPageSchema,
  signInRefusalSchema,
  type AuthenticatorSetup,
  type CodeAnswer,
  type FirstUser,
  type PasswordSignIn,
  type RecoveryCodes,
  type SignInOutcome,
} from "@the-office/contracts";
import {
  deleteFromApi,
  getFromApi,
  sendToApi,
  sendToApiRefusedAs,
  sendToApiWithNoAnswer,
  sendToApiWithNoAnswerRefusedAs,
} from "./api-client.ts";

/** The signed-in user's own: their account and its signed-in devices. */
export const ACCOUNT = ["account"] as const;

export const userQueries = {
  /** Whether The Office waits for its first user, and the ways to sign in at this address. */
  signInPage: () =>
    queryOptions({
      queryKey: ["sign-in"],
      queryFn: ({ signal }) => getFromApi("/sign-in", signInPageSchema, signal),
    }),
  /** The signed-in user's name and email; answering at all says this browser is signed in. */
  account: () =>
    queryOptions({
      queryKey: ACCOUNT,
      queryFn: ({ signal }) => getFromApi("/account", accountSchema, signal),
      staleTime: Infinity,
    }),
  /** The user's signed-in devices, the most recently used first, this one marked. */
  signedInDevices: () =>
    queryOptions({
      queryKey: [...ACCOUNT, "signed-in-devices"],
      queryFn: ({ signal }) =>
        getFromApi("/account/signed-in-devices", signedInDeviceListSchema, signal),
    }),
};

/** Creates the first user at first run and signs this browser in as them. */
export function createFirstUser(firstUser: FirstUser): Promise<SignInOutcome> {
  return sendToApi("POST", "/sign-in/first-user", firstUser, signInOutcomeSchema);
}

/**
 * Signs in with an email and a password; refused as `RefusedAs<SignInRefusal>`, with when to try
 * again once tries cost a wait.
 */
export function signInWithPassword(signIn: PasswordSignIn): Promise<SignInOutcome> {
  return sendToApiRefusedAs("/sign-in/password", signIn, signInOutcomeSchema, signInRefusalSchema);
}

/**
 * Signs in with the authenticator code or a recovery code, for the pending sign-in its cookie names;
 * refused as `RefusedAs<SignInRefusal>`, and as `SignedOut` once the pending sign-in has ended.
 */
export function signInWithCode(answer: CodeAnswer): Promise<SignInOutcome> {
  return sendToApiRefusedAs("/sign-in/code", answer, signInOutcomeSchema, signInRefusalSchema);
}

/** Starts setting up the authenticator: the QR code's address and the key, shown this once. */
export function setUpAuthenticator(): Promise<AuthenticatorSetup> {
  return sendToApi("POST", "/account/authenticator", {}, authenticatorSetupSchema);
}

/** Turns the authenticator on with its first code; answers the recovery codes, shown this once. */
export function confirmAuthenticator(code: string): Promise<RecoveryCodes> {
  return sendToApiRefusedAs(
    "/account/authenticator/confirm",
    { code },
    recoveryCodesSchema,
    signInRefusalSchema,
  );
}

/** Turns the authenticator off with its code or a recovery code; its recovery codes go too. */
export function turnOffAuthenticator(answer: CodeAnswer): Promise<void> {
  return sendToApiWithNoAnswerRefusedAs(
    "DELETE",
    "/account/authenticator",
    answer,
    signInRefusalSchema,
  );
}

/** New recovery codes in place of all the old ones, with the authenticator's code. */
export function makeNewRecoveryCodes(code: string): Promise<RecoveryCodes> {
  return sendToApiRefusedAs(
    "/account/recovery-codes",
    { code },
    recoveryCodesSchema,
    signInRefusalSchema,
  );
}

/** Signs out this device. */
export function signOut(): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/sign-out", {});
}

/** Signs out one of the user's signed-in devices, this one included. */
export function signOutDevice(id: string): Promise<void> {
  return deleteFromApi(`/account/signed-in-devices/${encodeURIComponent(id)}`);
}

/** The sign-in page's address, outside the shell; `?returnTo=` names where it returns to. */
export const SIGN_IN_PATH = "/sign-in";

/** The page asking for the authenticator code after a sign-in, outside the shell too. */
export const SIGN_IN_CODE_PATH = "/sign-in/code";

/**
 * Where the sign-in page returns to: `returnTo` when it is a path of this app (starting with one "/"),
 * so a link can't send the user to another site; otherwise home.
 */
export function returnPathOf(returnTo: string | undefined): string {
  if (returnTo === undefined || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }
  if (
    returnTo.startsWith("/\\") ||
    returnTo === SIGN_IN_PATH ||
    returnTo.startsWith(`${SIGN_IN_PATH}?`) ||
    returnTo.startsWith(`${SIGN_IN_PATH}/`)
  ) {
    return "/";
  }
  return returnTo;
}
