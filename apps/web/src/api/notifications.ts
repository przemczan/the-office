import { queryOptions } from "@tanstack/react-query";
import { notificationsWebEventSchema, nowSchema, type Activity } from "@the-office/contracts";
import { getFromApi, postToApi } from "./api-client.ts";
import type { EventCacheUpdates } from "./event-stream-provider.tsx";

export const nowQueries = {
  /** Now and the status strip, kept current by `now.changed`. */
  now: () =>
    queryOptions({
      queryKey: ["now"],
      queryFn: ({ signal }) => getFromApi("/now", nowSchema, signal),
    }),
};

/**
 * Tells the service the user is active, and on which page: where Since you left begins, and what
 * the user opened, which handles the Notifications pointing at it.
 */
export function reportActivity(activity: Activity): Promise<void> {
  return postToApi("/activity", activity);
}

/** Now comes whole with each change, so the page and the strip refetch nothing. */
export const nowEventCacheUpdates: EventCacheUpdates = {
  "now.changed": (event, queryClient) => {
    const changed = notificationsWebEventSchema.parse(event);
    if (changed.type !== "now.changed") return;
    queryClient.setQueryData(nowQueries.now().queryKey, changed.now);
  },
};
