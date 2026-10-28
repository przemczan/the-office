import { useQuery } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { roleQueries } from "../api/people.ts";

/** Whoever fills the Role by its key; undefined while nobody does, or until the Roles are read. */
export function useHired(roleKey: string): Role | undefined {
  const roles = useQuery(roleQueries.list());
  return roles.data?.find(({ key, letGoAt }) => key === roleKey && letGoAt === null);
}
