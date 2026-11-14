import { randomUUID } from "node:crypto";
import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import {
  isHeld,
  phoneDeliveryOf,
  quietHoursSummary,
  raisedBy,
  shownOf,
} from "../domain/delivery.js";
import type { Notification } from "../domain/notification.js";
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
import { NotificationRepository } from "../ports/notification-repository.js";
import { NotificationTimingRepository } from "../ports/notification-timing-repository.js";
import { PhonePush } from "../ports/phone-push.js";
import type { UserActivity } from "../domain/user-activity.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

/**
 * When each Notification reaches its channels (spec §2.7): it goes to the browser as raised, held
 * from the desktop inside quiet hours; to the phone once every user has been away long enough (The
 * Office is away only when nobody is at the desk), or in the one summary when quiet hours end. Waits run on The Office's clock and are kept in memory,
 * so they are set again at boot from the open Notifications.
 */
@Injectable()
export class NotificationDelivery implements OnApplicationBootstrap {
  private readonly phoneWaits = new Map<string, Wait>();
  private quietHoursWait: Wait | undefined;

  constructor(
    private readonly repository: NotificationRepository,
    private readonly timing: NotificationTimingRepository,
    private readonly activity: UserActivityRepository,
    private readonly phone: PhonePush,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.events.subscribe(NotificationsCleared, ({ notificationIds }) => {
      for (const id of notificationIds) this.stopPhoneWait(id);
    });
    await this.setWaits();
  }

  readTiming(): Promise<NotificationTiming> {
    return this.timing.read();
  }

  /** The user changed the timing: every wait is worked out again by it. */
  async setTiming(timing: NotificationTiming): Promise<NotificationTiming> {
    await this.timing.save(timing);
    await this.events.publish(new TimingChanged(timing));
    await this.setWaits();
    return timing;
  }

  /** Sends a Notification just raised in place of those it replaces, then to the phone by the rules. */
  async send(notification: Notification, replaces: readonly string[] = []): Promise<void> {
    for (const id of replaces) this.stopPhoneWait(id);
    await this.events.publish(new NotificationRaised(notification, replaces));
    const [timing, activity] = await Promise.all([this.timing.read(), this.activity.findLatest()]);
    await this.toPhone(notification, timing, activity);
    if (notification.held.length > 0) await this.waitForQuietHoursEnd(timing);
  }

  /** Every wait, from the open Notifications: at boot, and when the timing changes. */
  private async setWaits(): Promise<void> {
    // Deleting the entry being visited is safe while iterating a Map.
    for (const id of this.phoneWaits.keys()) this.stopPhoneWait(id);
    this.quietHoursWait?.cancel();
    this.quietHoursWait = undefined;
    const [timing, activity, shown] = await Promise.all([
      this.timing.read(),
      this.activity.findLatest(),
      this.shown(),
    ]);
    for (const notification of shown) await this.toPhone(notification, timing, activity);
    if ((await this.shown()).some(isHeld)) {
      await this.waitForQuietHoursEnd(timing);
    }
  }

  private async toPhone(
    notification: Notification,
    timing: NotificationTiming,
    activity: UserActivity | undefined,
  ): Promise<void> {
    const at = this.schedule.now();
    const delivery = phoneDeliveryOf(notification, timing, activity, at);
    switch (delivery.kind) {
      case "none":
        return;
      case "now":
        await this.phone.push(notification);
        await this.repository.phonePushed(notification.id, at);
        return;
      case "held":
        await this.repository.hold([notification.id], [...notification.held, "phone"]);
        await this.waitForQuietHoursEnd(timing);
        return;
      case "wait":
        this.stopPhoneWait(notification.id);
        this.phoneWaits.set(
          notification.id,
          this.schedule.once(`Phone push ${notification.id}`, delivery.until, () =>
            this.phoneWaitEnded(notification.id),
          ),
        );
    }
  }

  /** The wait ended: unless handled or collapsed meanwhile, the rules decide again. */
  private async phoneWaitEnded(id: string): Promise<void> {
    this.phoneWaits.delete(id);
    const notification = (await this.shown()).find((shown) => shown.id === id);
    if (!notification) return;
    const [timing, activity] = await Promise.all([this.timing.read(), this.activity.findLatest()]);
    await this.toPhone(notification, timing, activity);
  }

  private async waitForQuietHoursEnd(timing: NotificationTiming): Promise<void> {
    if (this.quietHoursWait) return;
    const at = this.schedule.now();
    if (!timing.quietHours || !inQuietHours(timing.quietHours, at)) {
      await this.sendSummary();
      return;
    }
    this.quietHoursWait = this.schedule.once(
      "Quiet hours end",
      quietHoursEnd(timing.quietHours, at),
      () => this.quietHoursEnded(),
    );
  }

  private async quietHoursEnded(): Promise<void> {
    this.quietHoursWait = undefined;
    await this.waitForQuietHoursEnd(await this.timing.read());
  }

  /** The one summary of what quiet hours held, after which nothing is held any more. */
  private async sendSummary(): Promise<void> {
    const at = this.schedule.now();
    const open = (await this.repository.listOpen()).filter(raisedBy(at));
    const summary = quietHoursSummary(open, randomUUID(), at);
    const heldIds = shownOf(open)
      .filter(isHeld)
      .map(({ id }) => id);
    await this.repository.hold(heldIds, []);
    if (!summary) return;
    await this.repository.add(summary);
    await this.send(summary);
  }

  /** The open Notifications the list shows, as far as the clock has reached. */
  private async shown(): Promise<Notification[]> {
    const at = this.schedule.now();
    return shownOf((await this.repository.listOpen()).filter(raisedBy(at)));
  }

  private stopPhoneWait(id: string): void {
    this.phoneWaits.get(id)?.cancel();
    this.phoneWaits.delete(id);
  }
}
