import type {
  Notification as NotificationResponse,
  NotificationRouting as NotificationRoutingResponse,
  NotificationTiming as NotificationTimingResponse,
  RoutedChannel as RoutedChannelResponse,
} from "@the-office/contracts";
import type { ReceivedNotification } from "../../domain/notification.js";
import type { NotificationTiming } from "../../domain/notification-timing.js";
import {
  ROUTING_LEVELS,
  routedChannel,
  type Channel,
  type Routing,
} from "../../domain/notification-kinds.js";

export function toNotificationResponse({
  id,
  kind,
  roleKey,
  line,
  shortLine,
  at,
  pointsTo,
  channels,
  held,
  raisedAt,
}: ReceivedNotification): NotificationResponse {
  return {
    id,
    kind,
    roleKey: roleKey ?? null,
    line,
    ...(shortLine === undefined ? {} : { shortLine }),
    ...(at === undefined ? {} : { at: at.toISOString() }),
    pointsTo,
    channels: [...channels],
    held: [...held],
    raisedAt: raisedAt.toISOString(),
  };
}

export function toTimingResponse({
  quietHours,
  ...minutes
}: NotificationTiming): NotificationTimingResponse {
  return { ...minutes, quietHours: quietHours ?? null };
}

/** Every level of the kinds tree with each channel as it routes there, for the grid. */
export function toRoutingResponse(routing: Routing): NotificationRoutingResponse {
  return Object.fromEntries(ROUTING_LEVELS.map((level) => [level, routedChannels(level, routing)]));
}

function routedChannels(level: string, routing: Routing): NotificationRoutingResponse[string] {
  const routed = (channel: Channel): RoutedChannelResponse => {
    const { on, from } = routedChannel(level, channel, routing);
    return { on, from: from ?? null };
  };
  return { "in-app": routed("in-app"), desktop: routed("desktop"), phone: routed("phone") };
}
