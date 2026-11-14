import type { Role } from "@the-office/contracts";
import { useDutyHolder } from "../use-duty-holder.ts";

/** Whoever holds Shapes Initiatives: an Initiative is shaped with them; undefined while nobody does. */
export function useShaper(): Role | undefined {
  return useDutyHolder("shapes-initiatives").holder;
}
