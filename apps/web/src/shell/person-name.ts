import type { Role } from "@the-office/contracts";

/** How every surface names the person in a Role: "Ada · Developer". */
export function personName({ card }: Pick<Role, "card">): string {
  return `${card.name} · ${card.title}`;
}
