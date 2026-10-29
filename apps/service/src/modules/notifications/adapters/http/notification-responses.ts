import type {
  Notification as NotificationResponse,
  NotificationRouting as NotificationRoutingResponse,
  RoutedChannel as RoutedChannelResponse,
} from "@the-office/contracts";
import type { Notification } from "../../domain/notification.js";
import {
  ROUTING_LEVELS,
  routedChannel,
  type Channel,
  type Routing,
} from "../../domain/notification-kinds.js";

export function toNotificationResponse(notification: Notification): NotificationResponse {
  return {
    ...notification,
    roleKey: notification.roleKey ?? null,
    channels: [...notification.channels],
    raisedAt: notification.raisedAt.toISOString(),
  };
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
