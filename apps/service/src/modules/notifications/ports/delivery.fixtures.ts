import type { Channel } from "../domain/notification-kinds.js";
import { DEFAULT_TIMING, type NotificationTiming } from "../domain/notification-timing.js";
import type { Notification } from "../domain/notification.js";
import type { UserActivity } from "../domain/user-activity.js";
import { NotificationRepository } from "./notification-repository.js";
import { NotificationTimingRepository } from "./notification-timing-repository.js";
import { UserActivityRepository } from "./user-activity-repository.js";

/**
 * The timing kept by one test alone: the stored row is one for every test file, which run at once,
 * and quiet hours set there would hold the others' Notifications.
 */
export class NotificationTimingForTests extends NotificationTimingRepository {
  timing: NotificationTiming = DEFAULT_TIMING;

  async read(): Promise<NotificationTiming> {
    return this.timing;
  }

  async save(timing: NotificationTiming): Promise<void> {
    this.timing = timing;
  }
}

/**
 * The user's activity kept by one test alone: the stored row is one for every test file, and
 * keeps only the latest activity, so a test on a clock of its own couldn't move it.
 */
export class UserActivityForTests extends UserActivityRepository {
  activity: UserActivity | undefined;

  async find(): Promise<UserActivity | undefined> {
    return this.activity;
  }

  async update(change: (known: UserActivity | undefined) => UserActivity): Promise<UserActivity> {
    this.activity = change(this.activity);
    return this.activity;
  }
}

/**
 * The Notifications kept by one test alone: the stored ones are shared by every test file, and an
 * open one another file raised would swallow this test's like it (one engine down at a time) or
 * be gathered into its batches and summaries.
 */
export class NotificationsForTests extends NotificationRepository {
  private readonly open = new Map<string, Notification>();

  async add(notification: Notification): Promise<void> {
    this.open.set(notification.id, notification);
  }

  async listOpen(): Promise<readonly Notification[]> {
    return [...this.open.values()].toSorted(
      (one, other) => one.raisedAt.getTime() - other.raisedAt.getTime(),
    );
  }

  async clear(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.open.delete(id);
  }

  async hold(ids: readonly string[], held: readonly Channel[]): Promise<void> {
    this.change(ids, { held });
  }

  async phonePushed(id: string, pushedAt: Date): Promise<void> {
    this.change([id], { phonePushedAt: pushedAt });
  }

  private change(ids: readonly string[], changed: Partial<Notification>): void {
    for (const id of ids) {
      const notification = this.open.get(id);
      if (notification) this.open.set(id, { ...notification, ...changed });
    }
  }
}
