import type { NotificationTiming } from "../domain/notification-timing.js";

/** Each user's timing, set in Account › Notifications: spec 2.7's defaults until the user sets it. */
export abstract class NotificationTimingRepository {
  abstract read(userId: string): Promise<NotificationTiming>;
  abstract save(userId: string, timing: NotificationTiming): Promise<void>;
}
