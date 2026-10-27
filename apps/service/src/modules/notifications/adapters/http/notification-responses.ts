import type { Notification as NotificationResponse } from "@the-office/contracts";
import type { Notification } from "../../domain/notification.js";

export function toNotificationResponse(notification: Notification): NotificationResponse {
  return {
    ...notification,
    roleKey: notification.roleKey ?? null,
    channels: [...notification.channels],
    raisedAt: notification.raisedAt.toISOString(),
  };
}
