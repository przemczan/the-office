import { queryOptions } from "@tanstack/react-query";
import { activitySchema, type ActivityWebEvent } from "@the-office/contracts";
import { getFromApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ACTIVITY = ["activity"] as const;

export const activityQueries = {
  /**
   * Activity: everything The Office is running, and what ended that the signed-in user hasn't seen,
   * with the status strip's count (spec 2.14).
   */
  list: () =>
    queryOptions({
      queryKey: ACTIVITY,
      queryFn: ({ signal }) => getFromApi("/activity", activitySchema, signal),
    }),
};

/** The signed-in user has seen these ended items; what changed arrives as `activity.changed`. */
export function markActivitySeen(itemIds: readonly string[]): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/activity/seen", { itemIds: [...itemIds] });
}

export const activityEventInvalidations: Readonly<
  Record<ActivityWebEvent["type"], EventInvalidations[string]>
> = {
  "activity.changed": () => [ACTIVITY],
};
