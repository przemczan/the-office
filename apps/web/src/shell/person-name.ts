import type { Role } from "@the-office/contracts";

/** How every surface names the person in a Role: "Ada · Developer". */
export function personName({ card }: Role): string {
  return `${card.name} · ${card.title}`;
}
