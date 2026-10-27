import type { Notification } from "../domain/notification.js";

export abstract class NotificationRepository {
  abstract add(notification: Notification): Promise<void>;
  /** The Notifications not yet cleared, oldest first. */
  abstract listOpen(): Promise<readonly Notification[]>;
  abstract clear(ids: readonly string[], clearedAt: Date): Promise<void>;
}
