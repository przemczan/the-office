import { DEFAULT_TIMING, type NotificationTiming } from "../domain/notification-timing.js";
import type { UserActivity } from "../domain/user-activity.js";
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
