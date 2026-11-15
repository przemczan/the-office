import { queryOptions } from "@tanstack/react-query";
import { liveViewSchema, liveViewWebEventSchema } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import type { EventCacheUpdates } from "./event-stream-provider.tsx";

export const liveViewQueries = {
  /**
   * What each person is doing now, kept current by `live-view.changed`. Only the Live view page
   * reads it, so an Office nobody watches does no extra reads.
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
    const changed = liveViewWebEventSchema.parse(event);
    queryClient.setQueryData(liveViewQueries.snapshot().queryKey, changed.liveView);
  },
};
