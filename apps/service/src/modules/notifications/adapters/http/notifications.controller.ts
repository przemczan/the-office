import { Controller, Get } from "@nestjs/common";
import type { Notification as NotificationResponse } from "@the-office/contracts";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { NotificationService } from "../../application/notification-service.js";
import { toNotificationResponse } from "./notification-responses.js";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * The Notifications not yet cleared that the requester sees, oldest first, on their channels;
   * raised and cleared ones come as events.
   */
  @Get()
  async listOpen(@SignedIn() { userId }: SignedIn): Promise<NotificationResponse[]> {
    return (await this.notifications.listOpen(userId)).map(toNotificationResponse);
  }
}
