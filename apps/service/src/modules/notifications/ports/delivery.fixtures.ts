import { receivedBy } from "../domain/delivery.js";
import type { Channel } from "../domain/notification-kinds.js";
import { DEFAULT_TIMING, type NotificationTiming } from "../domain/notification-timing.js";
import type { Delivery, Notification, ReceivedNotification } from "../domain/notification.js";
import type { UserActivity } from "../domain/user-activity.js";
import { NotificationRepository } from "./notification-repository.js";
import { NotificationTimingRepository } from "./notification-timing-repository.js";
import { UserActivityRepository } from "./user-activity-repository.js";

/** Each user's timing kept by one test alone, by their id; the defaults for a user with none. */
export class NotificationTimingForTests extends NotificationTimingRepository {
  readonly timings = new Map<string, NotificationTiming>();

  async read(userId: string): Promise<NotificationTiming> {
    return this.timings.get(userId) ?? DEFAULT_TIMING;
  }

  async save(userId: string, timing: NotificationTiming): Promise<void> {
    this.timings.set(userId, timing);
  }
}

/**
 * The users' activity kept by one test alone: the stored rows are shared by every test file, and
 * keep only each user's latest activity, so a test on a clock of its own couldn't move it.
 */
export class UserActivityForTests extends UserActivityRepository {
  readonly activities = new Map<string, UserActivity>();

  async find(userId: string): Promise<UserActivity | undefined> {
    return this.activities.get(userId);
  }

  async update(
    userId: string,
    change: (known: UserActivity | undefined) => UserActivity,
  ): Promise<{ readonly before: UserActivity | undefined; readonly after: UserActivity }> {
    const before = this.activities.get(userId);
    const after = change(before);
    this.activities.set(userId, after);
    return { before, after };
  }
}

/**
 * The Notifications kept by one test alone: the stored ones are shared by every test file, and an
 * open one another file raised would swallow this test's like it (one engine down at a time) or
 * be gathered into its batches and summaries.
 */
export class NotificationsForTests extends NotificationRepository {
  private readonly open = new Map<string, Notification>();
  /** Each delivery, by the user's id, then by the Notification's. */
  private readonly deliveries = new Map<string, Map<string, Delivery>>();

  async add({
    id,
    kind,
    roleKey,
    line,
    shortLine,
    at,
    pointsTo,
    raisedAt,
    gathers,
    forUser,
  }: Notification): Promise<void> {
    const notification = { id, kind, roleKey, line, shortLine, at, pointsTo, raisedAt, gathers };
    this.open.set(id, { ...notification, forUser });
  }

  async deliver(delivery: Delivery): Promise<void> {
    const byNotification = this.deliveries.get(delivery.userId) ?? new Map<string, Delivery>();
    byNotification.set(delivery.notificationId, delivery);
    this.deliveries.set(delivery.userId, byNotification);
  }

  async listOpen(): Promise<readonly Notification[]> {
    return [...this.open.values()].toSorted(
      (one, other) => one.raisedAt.getTime() - other.raisedAt.getTime(),
    );
  }

  async listReceived(userId: string): Promise<readonly ReceivedNotification[]> {
    return receivedBy(userId, await this.listOpen(), [
      ...(this.deliveries.get(userId)?.values() ?? []),
    ]);
  }

  /** The user's delivery of the Notification, undefined when it reached them on no channel. */
  deliveryTo(userId: string, notificationId: string): Delivery | undefined {
    return this.deliveries.get(userId)?.get(notificationId);
  }

  async clear(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.open.delete(id);
  }

  async hold(userId: string, ids: readonly string[], held: readonly Channel[]): Promise<void> {
    this.change(userId, ids, { held });
  }

  async phonePushed(userId: string, id: string, pushedAt: Date): Promise<void> {
    this.change(userId, [id], { phonePushedAt: pushedAt });
  }

  private change(userId: string, ids: readonly string[], changed: Partial<Delivery>): void {
    const byNotification = this.deliveries.get(userId);
    for (const id of ids) {
      const delivery = byNotification?.get(id);
      if (delivery) byNotification?.set(id, { ...delivery, ...changed });
    }
  }
}
