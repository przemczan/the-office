import { queryOptions } from "@tanstack/react-query";
import {
  googleClientSchema,
  googleClientSettingSchema,
  type GoogleClient,
  type SaveGoogleClient,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";

/** The Google OAuth client Continue with Google signs in through, one per Office. */
export const GOOGLE_CLIENT = ["settings", "google-client"] as const;

export const googleClientQueries = {
  /** The saved client's id and whether a secret is saved, or null before one is. */
  setting: () =>
    queryOptions({
      queryKey: GOOGLE_CLIENT,
      queryFn: ({ signal }) =>
        getFromApi("/settings/google-client", googleClientSettingSchema, signal),
    }),
};

/** Saves the client; an empty secret keeps the saved one. */
export function saveGoogleClient(client: SaveGoogleClient): Promise<GoogleClient> {
  return sendToApi("PUT", "/settings/google-client", client, googleClientSchema);
}

export function removeGoogleClient(): Promise<void> {
  return deleteFromApi("/settings/google-client");
}
