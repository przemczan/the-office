import { queryOptions } from "@tanstack/react-query";
import {
  presetListSchema,
  roleCardOptionsSchema,
  roleChangeListSchema,
  roleListSchema,
  roleSchema,
  type Hire,
  type Role,
  type RoleCardEdit,
  type RoleWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ROLES = ["roles"] as const;

export const roleQueries = {
  /** Every Role someone fills, in hiring order. */
  list: () =>
    queryOptions({
      queryKey: ROLES,
      queryFn: ({ signal }) => getFromApi("/roles", roleListSchema, signal),
    }),
  one: (key: string) =>
    queryOptions({
      queryKey: [...ROLES, key],
      queryFn: ({ signal }) => getFromApi(rolePath(key), roleSchema, signal),
    }),
  /** The Role's change history, newest first, ending with the hire. */
  changes: (key: string) =>
    queryOptions({
      queryKey: [...ROLES, key, "changes"],
      queryFn: ({ signal }) => getFromApi(`${rolePath(key)}/changes`, roleChangeListSchema, signal),
    }),
};

/** What hiring and the Role card form offer; neither changes while the service runs. */
export const roleCardQueries = {
  presets: () =>
    queryOptions({
      queryKey: ["presets"],
      queryFn: ({ signal }) => getFromApi("/presets", presetListSchema, signal),
      staleTime: Infinity,
    }),
  options: () =>
    queryOptions({
      queryKey: ["role-card-options"],
      queryFn: ({ signal }) => getFromApi("/role-card-options", roleCardOptionsSchema, signal),
      staleTime: Infinity,
    }),
};

export function hire(hiring: Hire): Promise<Role> {
  return sendToApi("POST", "/roles", hiring, roleSchema);
}

/** Saves the card's next version; sessions started from now on get it. */
export function changeRoleCard(key: string, card: RoleCardEdit): Promise<Role> {
  return sendToApi("PUT", `${rolePath(key)}/card`, card, roleSchema);
}

/**
 * Every People event makes the Roles stale; ["roles"] also covers each Role's own queries. A hire
 * also changes who the other Roles' Consult values reach.
 */
export const roleEventInvalidations: Readonly<
  Record<RoleWebEvent["type"], EventInvalidations[string]>
> = {
  "role.hired": () => [ROLES],
  "role.card-changed": () => [ROLES],
};

function rolePath(key: string): `/${string}` {
  return `/roles/${encodeURIComponent(key)}`;
}
