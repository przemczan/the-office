import { Injectable, type OnModuleInit } from "@nestjs/common";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { NotificationRaised, NotificationsCleared } from "../../domain/notification-events.js";
import { NowChanged } from "../../domain/now-events.js";
import { toNotificationResponse } from "../http/notification-responses.js";
import { toNowResponse } from "../http/now-responses.js";

/**
 * Now reaches the web whole on each change, so the page and the strip need no refetch; each
 * Notification reaches it as raised and as cleared, for the channels that live there.
 */
@Injectable()
export class NotificationsWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(NowChanged, (event) => ({
      type: "now.changed",
      now: toNowResponse(event.now),
    }));
    this.forwarding.forward(NotificationRaised, (event) => ({
      type: "notification.raised",
      notification: toNotificationResponse(event.notification),
      replaces: [...event.replaces],
    }));
    this.forwarding.forward(NotificationsCleared, (event) => ({
      type: "notifications.cleared",
      notificationIds: [...event.notificationIds],
    }));
  }
}
