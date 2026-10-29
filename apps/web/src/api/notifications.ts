import { queryOptions } from "@tanstack/react-query";
import {
  notificationListSchema,
  notificationRoutingSchema,
  notificationsWebEventSchema,
  nowSchema,
  type Activity,
  type ChannelSetting,
  type Notification,
  type NotificationRouting,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, postToApi, sendToApi } from "./api-client.ts";
import type { EventCacheUpdates } from "./event-stream-provider.tsx";

export const nowQueries = {
  /** Now and the status strip, kept current by `now.changed`. */
  now: () =>
    queryOptions({
      queryKey: ["now"],
      queryFn: ({ signal }) => getFromApi("/now", nowSchema, signal),
    }),
};

export const notificationQueries = {
  /** The Notifications not yet cleared, oldest first, kept current by their events. */
  open: () =>
    queryOptions({
      queryKey: ["notifications"],
      queryFn: ({ signal }) => getFromApi("/notifications", notificationListSchema, signal),
    }),
  /** What goes where: each level of the kinds tree with every channel as it routes there. */
  routing: () =>
    queryOptions({
      queryKey: ["notification-routing"],
      queryFn: ({ signal }) =>
        getFromApi("/notifications/routing", notificationRoutingSchema, signal),
    }),
};

/** Sets a channel at a level of the kinds tree; the answer is the whole routing. */
export function setRoutingChannel(
  level: string,
  setting: ChannelSetting,
): Promise<NotificationRouting> {
  return sendToApi("PUT", `/notifications/routing/${level}`, setting, notificationRoutingSchema);
}

/** Gives a kind back to its group; the answer is the whole routing. */
export function resetRouting(level: string): Promise<NotificationRouting> {
  return deleteFromApiReturning(`/notifications/routing/${level}`, notificationRoutingSchema);
}

/**
 * Tells the service the user is active, and on which page: where Since you left begins, and what
 * the user opened, which handles the Notifications pointing at it.
 */
export function reportActivity(activity: Activity): Promise<void> {
  return postToApi("/activity", activity);
}

/**
 * Now comes whole with each change, and each Notification as raised and as cleared, so the page,
 * the strip and the channels refetch nothing.
 */
export const notificationEventCacheUpdates: EventCacheUpdates = {
  "now.changed": (event, queryClient) => {
    const changed = notificationsWebEventSchema.parse(event);
    if (changed.type !== "now.changed") return;
    queryClient.setQueryData(nowQueries.now().queryKey, changed.now);
  },
  "notification.raised": (event, queryClient) => {
    const raised = notificationsWebEventSchema.parse(event);
    if (raised.type !== "notification.raised") return;
    queryClient.setQueryData(notificationQueries.open().queryKey, (open: Notification[] = []) =>
      open.some(({ id }) => id === raised.notification.id) ? open : [...open, raised.notification],
    );
  },
  "notifications.cleared": (event, queryClient) => {
    const cleared = notificationsWebEventSchema.parse(event);
    if (cleared.type !== "notifications.cleared") return;
    queryClient.setQueryData(notificationQueries.open().queryKey, (open: Notification[] = []) =>
      open.filter(({ id }) => !cleared.notificationIds.includes(id)),
    );
  },
};
