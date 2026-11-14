import type { Role } from "@the-office/contracts";

/** People's grid: the built-in Caretaker pinned first (spec §2.2), the rest as listed. */
export function inGridOrder<Person extends Pick<Role, "builtIn">>(
  roles: readonly Person[],
): Person[] {
  return roles.toSorted((one, other) => Number(other.builtIn) - Number(one.builtIn));
}

/**
 * Whether nobody is hired yet: no Role but the built-in Caretaker is filled by someone not let go,
 * so People offers to set The Office up (spec §2.2, "Setting up an Office with nobody hired").
 */
export function isNobodyHired(roles: readonly Pick<Role, "builtIn" | "letGoAt">[]): boolean {
  return roles.every(({ builtIn, letGoAt }) => builtIn || letGoAt !== null);
}
