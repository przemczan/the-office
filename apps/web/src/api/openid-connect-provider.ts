import { queryOptions } from "@tanstack/react-query";
import {
  openIdConnectProviderSchema,
  openIdConnectProviderSettingSchema,
  type OpenIdConnectProvider,
  type SaveOpenIdConnectProvider,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";

/** The OpenID Connect provider Continue with <name> signs in through, one per Office. */
export const OPENID_CONNECT_PROVIDER = ["settings", "openid-connect-provider"] as const;

export const openIdConnectProviderQueries = {
  /** The saved provider, or null before one is. */
  setting: () =>
    queryOptions({
      queryKey: OPENID_CONNECT_PROVIDER,
      queryFn: ({ signal }) =>
        getFromApi("/settings/openid-connect-provider", openIdConnectProviderSettingSchema, signal),
    }),
};

/** Saves the provider; an empty secret keeps the saved one. */
export function saveOpenIdConnectProvider(
  provider: SaveOpenIdConnectProvider,
): Promise<OpenIdConnectProvider> {
  return sendToApi(
    "PUT",
    "/settings/openid-connect-provider",
    provider,
    openIdConnectProviderSchema,
  );
}

export function removeOpenIdConnectProvider(): Promise<void> {
  return deleteFromApi("/settings/openid-connect-provider");
}
