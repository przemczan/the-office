import { queryOptions } from "@tanstack/react-query";
import {
  notificationListSchema,
  notificationRoutingSchema,
  notificationTimingSchema,
  notificationsWebEventSchema,
  nowSchema,
  sinceYouLeftSchema,
  type UserActivityReport,
  type ChannelSetting,
  type Notification,
  type NotificationRouting,
  type NotificationTiming,
} from "@the-office/contracts";
import {
  deleteFromApiReturning,
  getFromApi,
  sendToApi,
  sendToApiWithNoAnswer,
} from "./api-client.ts";
import { readEvent, type EventCacheUpdates } from "./event-stream-provider.tsx";

export const nowQueries = {
  /** Now and the status strip, kept current by `now.changed`. */
  now: () =>
    queryOptions({
      queryKey: ["now"],
      queryFn: ({ signal }) => getFromApi("/now", nowSchema, signal),
    }),
  /** The signed-in user's own Since you left, read again on each `now.changed`. */
  sinceYouLeft: () =>
    queryOptions({
      queryKey: ["since-you-left"],
      queryFn: ({ signal }) => getFromApi("/now/since-you-left", sinceYouLeftSchema, signal),
    }),
};

export const notificationQueries = {
  /** The Notifications not yet cleared, oldest first, kept current by their events. */
  open: () =>
    queryOptions({
      queryKey: ["notifications"],
      queryFn: ({ signal }) => getFromApi("/notifications", notificationListSchema, signal),
    }),
  /**
   * The signed-in user's own What goes where: each level of the kinds tree with every channel as it
   * routes there.
   */
  routing: () =>
    queryOptions({
      queryKey: ["notification-routing"],
      queryFn: ({ signal }) =>
        getFromApi("/account/notifications/routing", notificationRoutingSchema, signal),
    }),
  /**
   * When the signed-in user's Notifications reach the desktop and the phone: the at-desk hold,
   * quiet hours, batching.
   */
  timing: () =>
    queryOptions({
      queryKey: ["notification-timing"],
      queryFn: ({ signal }) =>
        getFromApi("/account/notifications/timing", notificationTimingSchema, signal),
    }),
};

/** Keeps the signed-in user's whole timing; the answer is what the service kept. */
export function setTiming(timing: NotificationTiming): Promise<NotificationTiming> {
  return sendToApi("PUT", "/account/notifications/timing", timing, notificationTimingSchema);
}

/** Sets a channel at a level of the signed-in user's kinds tree; the answer is their whole routing. */
export function setRoutingChannel(
  level: string,
  setting: ChannelSetting,
): Promise<NotificationRouting> {
  return sendToApi(
    "PUT",
    `/account/notifications/routing/${level}`,
    setting,
    notificationRoutingSchema,
  );
}

/** Gives one of the signed-in user's kinds back to its group; the answer is their whole routing. */
export function resetRouting(level: string): Promise<NotificationRouting> {
  return deleteFromApiReturning(
    `/account/notifications/routing/${level}`,
    notificationRoutingSchema,
  );
}

/**
 * Tells the service the user is active, and on which page: where Since you left begins, and what
 * the user opened, which handles the Notifications pointing at it.
 */
export function reportActivity(activity: UserActivityReport): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/activity", activity);
}

/**
 * Now comes whole with each change, and each Notification as raised and as cleared, so the page,
 * the strip and the channels refetch nothing of them. Since you left is each user's own, so each
 * `now.changed` has it read again.
 */
export const notificationEventCacheUpdates: EventCacheUpdates = {
  "now.changed": (event, queryClient) => {
    const now = nowQueries.now().queryKey;
    const sinceYouLeft = nowQueries.sinceYouLeft().queryKey;
    const changed = readEvent(notificationsWebEventSchema, event, queryClient, [now, sinceYouLeft]);
    if (changed?.type !== "now.changed") return;
    queryClient.setQueryData(now, changed.now);
    void queryClient.invalidateQueries({ queryKey: sinceYouLeft });
  },
  "notification.raised": (event, queryClient) => {
    const open = notificationQueries.open().queryKey;
    const raised = readEvent(notificationsWebEventSchema, event, queryClient, [open]);
    if (raised?.type !== "notification.raised") return;
    // Collapsed Outcomes take the place of the Outcome, or the collapse, shown before them.
    const { notification, replaces } = raised;
    queryClient.setQueryData(open, (shown: Notification[] = []) =>
      shown.some(({ id }) => id === notification.id)
        ? shown
        : [...shown.filter(({ id }) => !replaces.includes(id)), notification],
    );
  },
  "notifications.cleared": (event, queryClient) => {
    const open = notificationQueries.open().queryKey;
    const cleared = readEvent(notificationsWebEventSchema, event, queryClient, [open]);
    if (cleared?.type !== "notifications.cleared") return;
    queryClient.setQueryData(open, (shown: Notification[] = []) =>
      shown.filter(({ id }) => !cleared.notificationIds.includes(id)),
    );
  },
};
