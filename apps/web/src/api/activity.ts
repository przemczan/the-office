import { queryOptions } from "@tanstack/react-query";
import { activitySchema, type ActivityWebEvent } from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ACTIVITY = ["activity"] as const;

export const activityQueries = {
  /**
   * Activity: the active sessions per subject and the other running work, with the status strip's
   * count (spec 2.14).
   */
  list: () =>
    queryOptions({
      queryKey: ACTIVITY,
      queryFn: ({ signal }) => getFromApi("/activity", activitySchema, signal),
    }),
};

export const activityEventInvalidations: Readonly<
  Record<ActivityWebEvent["type"], EventInvalidations[string]>
> = {
  "activity.changed": () => [ACTIVITY],
};
