import { queryOptions } from "@tanstack/react-query";
import {
  accountSchema,
  addedUserSchema,
  authenticatorSetupSchema,
  oneTimePasswordSchema,
  recoveryCodesSchema,
  signedInDeviceListSchema,
  signInOutcomeSchema,
  signInPageSchema,
  signInRefusalSchema,
  userListSchema,
  type Account,
  type AddedUser,
  type Appearance,
  type AuthenticatorSetup,
  type CodeAnswer,
  type FirstPassword,
  type FirstUser,
  type NewUser,
  type PasswordChange,
  type PasswordSignIn,
  type ProfileChange,
  type RecoveryCodes,
  type SignInOutcome,
  type UserWebEvent,
} from "@the-office/contracts";
import {
  deleteFromApi,
  getFromApi,
  sendToApi,
  sendToApiRefusedAs,
  sendToApiWithNoAnswer,
  sendToApiWithNoAnswerRefusedAs,
} from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

/** The signed-in user's own: their account and its signed-in devices. */
export const ACCOUNT = ["account"] as const;
/** The Office's users, as Settings › Users lists them. */
export const USERS = ["users"] as const;

export const userQueries = {
  /** Whether The Office waits for its first user, and the ways to sign in at this address. */
  signInPage: () =>
    queryOptions({
      queryKey: ["sign-in"],
      queryFn: ({ signal }) => getFromApi("/sign-in", signInPageSchema, signal),
    }),
  /**
   * The signed-in user's name, email and appearance; answering at all says this browser is signed
   * in.
   */
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
  /** The users not removed, `you` marking the signed-in one. */
  list: () =>
    queryOptions({
      queryKey: USERS,
      queryFn: ({ signal }) => getFromApi("/users", userListSchema, signal),
    }),
};

/**
 * A user added, changed or removed makes the list stale, and the account, which may be this user's
 * own changed on another device.
 */
export const userEventInvalidations: Readonly<
  Record<UserWebEvent["type"], EventInvalidations[string]>
> = {
  "user.created": () => [USERS],
  "user.changed": () => [USERS, ACCOUNT],
  "user.removed": () => [USERS],
};

/** Adds a user; the answer holds their one-time password, shown this once. */
export function addUser(newUser: NewUser): Promise<AddedUser> {
  return sendToApi("POST", "/users", newUser, addedUserSchema);
}

/** A new one-time password for a user who hasn't signed in yet; the old one stops working. */
export async function newOneTimePassword(userId: string): Promise<string> {
  const { oneTimePassword } = await sendToApi(
    "POST",
    `/users/${encodeURIComponent(userId)}/one-time-password`,
    {},
    oneTimePasswordSchema,
  );
  return oneTimePassword;
}

/** Removes a user, signing out all their devices. */
export function removeUser(userId: string): Promise<void> {
  return deleteFromApi(`/users/${encodeURIComponent(userId)}`);
}

/**
 * Sets a new user's own password with their one-time password, and signs this browser in; refused
 * as `RefusedAs<SignInRefusal>` as a sign-in is, or with the password rules' reasons.
 */
export function setFirstPassword(firstPassword: FirstPassword): Promise<SignInOutcome> {
  return sendToApiRefusedAs(
    "/sign-in/set-password",
    firstPassword,
    signInOutcomeSchema,
    signInRefusalSchema,
  );
}

/** Changes the signed-in user's name, email or both. */
export function changeProfile(change: ProfileChange): Promise<Account> {
  return sendToApi("PATCH", "/account", change, accountSchema);
}

/** Changes the signed-in user's password, signing out their other devices. */
export function changePassword(change: PasswordChange): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/account/password", change);
}

/** Keeps the signed-in user's palette and density; answers the account as it now is. */
export function saveAppearance(appearance: Appearance): Promise<Account> {
  return sendToApi("PUT", "/account/appearance", appearance, accountSchema);
}

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
