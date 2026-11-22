import type { Channel } from "../domain/notification-kinds.js";
import type { Delivery, Notification, ReceivedNotification } from "../domain/notification.js";

export abstract class NotificationRepository {
  abstract add(notification: Notification): Promise<void>;
  /** Keeps how a Notification reaches one user. */
  abstract deliver(delivery: Delivery): Promise<void>;
  /** The Notifications not yet cleared, every user's, oldest first. */
  abstract listOpen(): Promise<readonly Notification[]>;
  /**
   * The Notifications not yet cleared that the user sees, oldest first: the shared ones and their
   * own, each with their delivery.
   */
  abstract listReceived(userId: string): Promise<readonly ReceivedNotification[]>;
  abstract clear(ids: readonly string[], clearedAt: Date): Promise<void>;
  /** Sets the channels the user's quiet hours hold these Notifications from. */
  abstract hold(userId: string, ids: readonly string[], held: readonly Channel[]): Promise<void>;
  abstract phonePushed(userId: string, id: string, pushedAt: Date): Promise<void>;
}
