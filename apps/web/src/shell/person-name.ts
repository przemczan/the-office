import type { Role } from "@the-office/contracts";

/** How every surface names the person in a Role: "Ada · Developer". */
export function personName({ card }: Pick<Role, "card">): string {
  return `${card.name} · ${card.title}`;
}

/** The person in the Role, "Ada · Developer"; the key itself when the Role is unknown or unread. */
export function roleName(roleKey: string, roles: readonly Role[] | undefined): string {
  const role = roles?.find(({ key }) => key === roleKey);
  return role ? personName(role) : roleKey;
}
