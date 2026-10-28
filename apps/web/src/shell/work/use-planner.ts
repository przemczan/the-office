import type { Role } from "@the-office/contracts";
import { useHired } from "../use-hired.ts";

/** The Planner's Role, by the preset's fixed key: planning opens its Thread with them. */
const PLANNER = "planner";

/** Whoever fills the Planner's Role. Planning is offered only then, as the service refuses it otherwise. */
export function usePlanner(): Role | undefined {
  return useHired(PLANNER);
}
