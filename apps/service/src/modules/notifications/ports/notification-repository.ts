import type { Channel } from "../domain/notification-kinds.js";
import type { Notification } from "../domain/notification.js";

export abstract class NotificationRepository {
  abstract add(notification: Notification): Promise<void>;
  /** The Notifications not yet cleared, oldest first. */
  abstract listOpen(): Promise<readonly Notification[]>;
  abstract clear(ids: readonly string[], clearedAt: Date): Promise<void>;
  /** Sets the channels quiet hours hold these Notifications from. */
  abstract hold(ids: readonly string[], held: readonly Channel[]): Promise<void>;
  abstract phonePushed(id: string, pushedAt: Date): Promise<void>;
}
