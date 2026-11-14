import { queryOptions } from "@tanstack/react-query";
import {
  identityAuthorizationSchema,
  identityCallbackUrlsSchema,
  linkedIdentityListSchema,
  type IdentityAuthorization,
  type IdentityProvider,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import { ACCOUNT } from "./users.ts";

/** The signed-in user's linked identities, part of their account. */
export const LINKED_IDENTITIES = [...ACCOUNT, "linked-identities"] as const;

export const linkedIdentityQueries = {
  /** Each provider, whether it is set up, and the user's identity there when linked. */
  list: () =>
    queryOptions({
      queryKey: LINKED_IDENTITIES,
      queryFn: ({ signal }) =>
        getFromApi("/account/linked-identities", linkedIdentityListSchema, signal),
    }),
  /** The callback URLs the provider must list, at this address and at the public address. */
  callbackUrls: (provider: IdentityProvider) =>
    queryOptions({
      queryKey: ["identity-callback-urls", provider],
      queryFn: ({ signal }) =>
        getFromApi(
          `/account/identity-callback-urls/${provider}`,
          identityCallbackUrlsSchema,
          signal,
        ),
      staleTime: Infinity,
    }),
};

/**
 * Starts Continue with the provider from the sign-in page: the provider's authorize page, and a
 * trip cookie for this browser. `returnTo` is where to go once signed in.
 */
export function continueWith(
  provider: IdentityProvider,
  returnTo: string | undefined,
): Promise<IdentityAuthorization> {
  return sendToApi(
    "POST",
    `/sign-in/${provider}`,
    returnTo === undefined ? {} : { returnTo },
    identityAuthorizationSchema,
  );
}

/** Starts linking the user's identity at the provider: the provider's authorize page. */
export function startLinking(provider: IdentityProvider): Promise<IdentityAuthorization> {
  return sendToApi(
    "POST",
    `/account/linked-identities/${provider}`,
    {},
    identityAuthorizationSchema,
  );
}

export function unlinkIdentity(provider: IdentityProvider): Promise<void> {
  return deleteFromApi(`/account/linked-identities/${provider}`);
}
