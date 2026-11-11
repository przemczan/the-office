import type { Role } from "@the-office/contracts";
import { useHired } from "../use-hired.ts";

/** The CTO's Role, by the preset's fixed key: an Initiative is shaped with them while one is hired. */
export const CTO_ROLE_KEY = "cto";

export function useCto(): Role | undefined {
  return useHired(CTO_ROLE_KEY);
}
