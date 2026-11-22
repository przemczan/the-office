import { randomUUID } from "node:crypto";
import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import {
  deliveryOf,
  isHeld,
  phoneDeliveryOf,
  quietHoursSummary,
  raisedBy,
  shownOf,
} from "../domain/delivery.js";
import { withTimeWorded, type ReceivedNotification } from "../domain/notification.js";
import {
  NotificationRaised,
  NotificationsCleared,
  TimingChanged,
} from "../domain/notification-events.js";
import {
  inQuietHours,
  quietHoursEnd,
  type NotificationTiming,
} from "../domain/notification-timing.js";
import type { UserActivity } from "../domain/user-activity.js";
import { NotificationRepository } from "../ports/notification-repository.js";
import { NotificationTimingRepository } from "../ports/notification-timing-repository.js";
import { OfficeUsers } from "../ports/office-users.js";
import { PhonePush } from "../ports/phone-push.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

/**
 * When each Notification reaches each user's channels (spec §2.7), by that user's own timing and
 * activity: it goes to their browser as raised, held from the desktop inside their quiet hours; to
 * their phone once they have been away long enough, or in their one summary when their quiet hours
 * end. Waits run on The Office's clock and are kept in memory, so they are set again at boot from
 * the open deliveries.
 */
@Injectable()
export class NotificationDelivery implements OnApplicationBootstrap {
  /** Each user's phone waits, by their id, then by the Notification's. */
  private readonly phoneWaits = new Map<string, Map<string, Wait>>();
  /** Each user's wait for their quiet hours to end, by their id. */
  private readonly quietHoursWaits = new Map<string, Wait>();

  constructor(
    private readonly repository: NotificationRepository,
    private readonly timing: NotificationTimingRepository,
    private readonly activity: UserActivityRepository,
    private readonly users: OfficeUsers,
    private readonly phone: PhonePush,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.events.subscribe(NotificationsCleared, ({ notificationIds }) => {
      for (const userId of this.phoneWaits.keys()) {
        for (const id of notificationIds) this.stopPhoneWait(userId, id);
      }
    });
    for (const { id } of await this.users.list()) await this.setWaits(id);
  }

  readTiming(userId: string): Promise<NotificationTiming> {
    return this.timing.read(userId);
  }

  /** The user changed their timing: each of their waits is worked out again by it. */
  async setTiming(userId: string, timing: NotificationTiming): Promise<NotificationTiming> {
    await this.timing.save(userId, timing);
    await this.events.publish(new TimingChanged(userId, timing));
    await this.setWaits(userId);
    return timing;
  }

  /**
   * Sends a Notification just raised to one user, in place of those it replaces for them, then to
   * their phone by the rules.
   */
  async send(
    userId: string,
    notification: ReceivedNotification,
    replaces: readonly string[] = [],
  ): Promise<void> {
    for (const id of replaces) this.stopPhoneWait(userId, id);
    await this.events.publish(new NotificationRaised(userId, notification, replaces));
    const [timing, activity] = await this.timingAndActivity(userId);
    await this.toPhone(userId, notification, timing, activity);
    if (notification.held.length > 0) await this.waitForQuietHoursEnd(userId, timing);
  }

  /** Each of the user's waits, from their open deliveries: at boot, and when their timing changes. */
  private async setWaits(userId: string): Promise<void> {
    for (const wait of this.phoneWaits.get(userId)?.values() ?? []) wait.cancel();
    this.phoneWaits.delete(userId);
    this.quietHoursWaits.get(userId)?.cancel();
    this.quietHoursWaits.delete(userId);
    const [[timing, activity], shown] = await Promise.all([
      this.timingAndActivity(userId),
      this.shown(userId),
    ]);
    for (const notification of shown) await this.toPhone(userId, notification, timing, activity);
    if ((await this.shown(userId)).some(isHeld)) await this.waitForQuietHoursEnd(userId, timing);
  }

  private async toPhone(
    userId: string,
    notification: ReceivedNotification,
    timing: NotificationTiming,
    activity: UserActivity | undefined,
  ): Promise<void> {
    const at = this.schedule.now();
    const delivery = phoneDeliveryOf(notification, timing, activity, at);
    switch (delivery.kind) {
      case "none":
        return;
      case "now":
        // The phone has no browser to word the time in its own zone: the service's words it.
        await this.phone.push(userId, withTimeWorded(notification, at));
        await this.repository.phonePushed(userId, notification.id, at);
        return;
      case "held":
        await this.repository.hold(userId, [notification.id], [...notification.held, "phone"]);
        await this.waitForQuietHoursEnd(userId, timing);
        return;
      case "wait":
        this.stopPhoneWait(userId, notification.id);
        this.phoneWaitsOf(userId).set(
          notification.id,
          this.schedule.once(`Phone push ${notification.id} to ${userId}`, delivery.until, () =>
            this.phoneWaitEnded(userId, notification.id),
          ),
        );
    }
  }

  /** The wait ended: unless handled or collapsed meanwhile, the rules decide again. */
  private async phoneWaitEnded(userId: string, id: string): Promise<void> {
    this.phoneWaits.get(userId)?.delete(id);
    const notification = (await this.shown(userId)).find((shown) => shown.id === id);
    if (!notification) return;
    const [timing, activity] = await this.timingAndActivity(userId);
    await this.toPhone(userId, notification, timing, activity);
  }

  private async waitForQuietHoursEnd(userId: string, timing: NotificationTiming): Promise<void> {
    if (this.quietHoursWaits.has(userId)) return;
    const at = this.schedule.now();
    if (!timing.quietHours || !inQuietHours(timing.quietHours, at)) {
      await this.sendSummary(userId);
      return;
    }
    this.quietHoursWaits.set(
      userId,
      this.schedule.once(
        `Quiet hours end for ${userId}`,
        quietHoursEnd(timing.quietHours, at),
        () => this.quietHoursEnded(userId),
      ),
    );
  }

  private async quietHoursEnded(userId: string): Promise<void> {
    this.quietHoursWaits.delete(userId);
    await this.waitForQuietHoursEnd(userId, await this.timing.read(userId));
  }

  /** The user's one summary of what their quiet hours held, after which nothing is held any more. */
  private async sendSummary(userId: string): Promise<void> {
    const at = this.schedule.now();
    const open = (await this.repository.listReceived(userId)).filter(raisedBy(at));
    const summary = quietHoursSummary(open, userId, randomUUID(), at);
    const heldIds = shownOf(open)
      .filter(isHeld)
      .map(({ id }) => id);
    await this.repository.hold(userId, heldIds, []);
    if (!summary) return;
    await this.repository.add(summary);
    await this.repository.deliver(deliveryOf(summary, userId));
    await this.send(userId, summary);
  }

  /** The open Notifications the user's list shows, as far as the clock has reached. */
  private async shown(userId: string): Promise<ReceivedNotification[]> {
    const at = this.schedule.now();
    return shownOf((await this.repository.listReceived(userId)).filter(raisedBy(at)));
  }

  private timingAndActivity(
    userId: string,
  ): Promise<[NotificationTiming, UserActivity | undefined]> {
    return Promise.all([this.timing.read(userId), this.activity.find(userId)]);
  }

  private phoneWaitsOf(userId: string): Map<string, Wait> {
    const waits = this.phoneWaits.get(userId) ?? new Map<string, Wait>();
    this.phoneWaits.set(userId, waits);
    return waits;
  }

  private stopPhoneWait(userId: string, id: string): void {
    const waits = this.phoneWaits.get(userId);
    waits?.get(id)?.cancel();
    waits?.delete(id);
  }
}
