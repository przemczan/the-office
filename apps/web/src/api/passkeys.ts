import { queryOptions } from "@tanstack/react-query";
import {
  passkeyCreationOptionsSchema,
  passkeyListSchema,
  passkeyRequestOptionsSchema,
  passkeySchema,
  signInOutcomeSchema,
  signInRefusalSchema,
  type NewPasskey,
  type Passkey,
  type PasskeyAuthentication,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type SignInOutcome,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi, sendToApiRefusedAs } from "./api-client.ts";
import { ACCOUNT } from "./users.ts";

/** The signed-in user's passkeys, part of their account. */
export const PASSKEYS = [...ACCOUNT, "passkeys"] as const;

export const passkeyQueries = {
  /** The user's passkeys, each with where it works, and why adding one doesn't work here. */
  list: () =>
    queryOptions({
      queryKey: PASSKEYS,
      queryFn: ({ signal }) => getFromApi("/account/passkeys", passkeyListSchema, signal),
    }),
};

/** Starts adding a passkey at this address, once the current password is the user's. */
export function startAddingPasskey(currentPassword: string): Promise<PasskeyCreationOptions> {
  return sendToApi(
    "POST",
    "/account/passkeys/options",
    { currentPassword },
    passkeyCreationOptionsSchema,
  );
}

/** Adds the passkey the browser made, with the user's name for it. */
export function addPasskey(newPasskey: NewPasskey): Promise<Passkey> {
  return sendToApi("POST", "/account/passkeys", newPasskey, passkeySchema);
}

export function renamePasskey(id: string, name: string): Promise<Passkey> {
  return sendToApi("PATCH", `/account/passkeys/${encodeURIComponent(id)}`, { name }, passkeySchema);
}

export function removePasskey(id: string): Promise<void> {
  return deleteFromApi(`/account/passkeys/${encodeURIComponent(id)}`);
}

/** Starts signing in with a passkey; the answer's cookie ties the passkey's answer to this browser. */
export function startPasskeySignIn(): Promise<PasskeyRequestOptions> {
  return sendToApi("POST", "/sign-in/passkey/options", {}, passkeyRequestOptionsSchema);
}

/** Signs in with the passkey's answer; refused as `RefusedAs<SignInRefusal>`, one answer for all. */
export function signInWithPasskey(authentication: PasskeyAuthentication): Promise<SignInOutcome> {
  return sendToApiRefusedAs(
    "/sign-in/passkey",
    authentication,
    signInOutcomeSchema,
    signInRefusalSchema,
  );
}
