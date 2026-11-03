import type { Role } from "@the-office/contracts";

/** People's grid: the built-in Caretaker pinned first (spec §2.2), the rest as listed. */
export function inGridOrder<Person extends Pick<Role, "builtIn">>(
  roles: readonly Person[],
): Person[] {
  return roles.toSorted((one, other) => Number(other.builtIn) - Number(one.builtIn));
}
