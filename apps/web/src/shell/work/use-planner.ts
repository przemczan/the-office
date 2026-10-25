import { useQuery } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { roleQueries } from "../../api/people.ts";

/** The Planner's Role, by the preset's fixed key: planning opens its Thread with them. */
const PLANNER = "planner";

/**
 * Whoever fills the Planner's Role; undefined while nobody does, or until the Roles are read.
 * Planning is offered only then, as the service refuses it otherwise.
 */
export function usePlanner(): Role | undefined {
  const roles = useQuery(roleQueries.list());
  return roles.data?.find(({ key }) => key === PLANNER);
}
