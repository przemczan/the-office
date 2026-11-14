import type { Role } from "@the-office/contracts";
import { useDutyHolder } from "../use-duty-holder.ts";

/** Whoever holds Plans. Planning is offered only then, as the service refuses it otherwise. */
export function usePlanner(): Role | undefined {
  return useDutyHolder("plans").holder;
}
