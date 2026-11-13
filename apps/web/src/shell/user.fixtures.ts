import type { QueryClient } from "@tanstack/react-query";
import type { Account, UserRef } from "@the-office/contracts";
import { userQueries } from "../api/users.ts";

/** The user signed in in this browser. */
export const SIGNED_IN: Account = {
  id: "7e6d5c4b-3a2f-4e1d-8c0b-9a8f7e6d5c4b",
  name: "Ada Park",
  email: "ada@x.io",
};

/** A record of the signed-in user's own, as a record keeps them. */
export const BY_YOU: UserRef = { userId: SIGNED_IN.id, name: SIGNED_IN.name };

/** A record of another user's. */
export const BY_ANN: UserRef = { userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", name: "Ann Lee" };

/** Signs `SIGNED_IN` in, as the account query answers. */
export function signIn(queryClient: QueryClient): void {
  queryClient.setQueryData(userQueries.account().queryKey, SIGNED_IN);
}
