import { queryOptions } from "@tanstack/react-query";
import { liveViewSchema, liveViewWebEventSchema } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import { readEvent, type EventCacheUpdates } from "./event-stream-provider.tsx";

export const liveViewQueries = {
  /**
   * What each person is doing now, kept current by `live-view.changed`. Only the Live view page
   * and Now's Agents section read it, so an Office nobody watches does no extra reads.
   */
  snapshot: () =>
    queryOptions({
      queryKey: ["live-view"],
      queryFn: ({ signal }) => getFromApi("/live-view", liveViewSchema, signal),
    }),
};

/** The snapshot comes whole with each change, so the page refetches nothing. */
export const liveViewEventCacheUpdates: EventCacheUpdates = {
  "live-view.changed": (event, queryClient) => {
    const { queryKey } = liveViewQueries.snapshot();
    const changed = readEvent(liveViewWebEventSchema, event, queryClient, [queryKey]);
    if (changed) queryClient.setQueryData(queryKey, changed.liveView);
  },
};
