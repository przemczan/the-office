import type { Role } from "@the-office/contracts";
import { useHired } from "../use-hired.ts";

/** The Planner's Role, by the preset's fixed key: planning opens its Thread with them. */
export const PLANNER_ROLE_KEY = "planner";

/** Whoever fills the Planner's Role. Planning is offered only then, as the service refuses it otherwise. */
export function usePlanner(): Role | undefined {
  return useHired(PLANNER_ROLE_KEY);
}
