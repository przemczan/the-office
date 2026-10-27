import { queryOptions } from "@tanstack/react-query";
import { notificationsWebEventSchema, nowSchema } from "@the-office/contracts";
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

/** Tells the service the user is active, which says where Since you left begins. */
export function reportActivity(): Promise<void> {
  return postToApi("/activity");
}

/** Now comes whole with each change, so the page and the strip refetch nothing. */
export const nowEventCacheUpdates: EventCacheUpdates = {
  "now.changed": (event, queryClient) => {
    queryClient.setQueryData(
      nowQueries.now().queryKey,
      notificationsWebEventSchema.parse(event).now,
    );
  },
};
