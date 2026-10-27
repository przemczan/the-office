import { Controller, Get } from "@nestjs/common";
import type { Notification as NotificationResponse } from "@the-office/contracts";
import { NotificationService } from "../../application/notification-service.js";
import { toNotificationResponse } from "./notification-responses.js";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** The Notifications not yet cleared, oldest first; raised and cleared ones come as events. */
  @Get()
  async listOpen(): Promise<NotificationResponse[]> {
    return (await this.notifications.listOpen()).map(toNotificationResponse);
  }
}
