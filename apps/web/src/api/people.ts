import { queryOptions } from "@tanstack/react-query";
import { roleListSchema, type RoleWebEvent } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ROLES = ["roles"] as const;

export const roleQueries = {
  /** Every Role someone fills, in hiring order. */
  list: () =>
    queryOptions({
      queryKey: ROLES,
      queryFn: ({ signal }) => getFromApi("/roles", roleListSchema, signal),
    }),
};

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
