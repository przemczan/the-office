import { queryOptions } from "@tanstack/react-query";
import { workstationLoadSchema } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";

/** How often the Workstation figure reads the workstation again. */
export const WORKSTATION_REFRESH_MS = 2000;

export const workstationQueries = {
  /**
   * The workstation's CPU and memory, read again every 2 s while the tab is visible: React Query
   * pauses an interval while the page is hidden (`refetchIntervalInBackground` is off). No retries,
   * as the next read comes soon and the strip already says when the service is gone.
   */
  load: () =>
    queryOptions({
      queryKey: ["workstation", "load"] as const,
      queryFn: ({ signal }) => getFromApi("/workstation/load", workstationLoadSchema, signal),
      refetchInterval: WORKSTATION_REFRESH_MS,
      refetchIntervalInBackground: false,
      retry: false,
    }),
};
