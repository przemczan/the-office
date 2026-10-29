import type { NotificationTiming } from "../domain/notification-timing.js";

/** The timing, in one row: the migration that made it stored ticket 20's defaults. */
export abstract class NotificationTimingRepository {
  abstract read(): Promise<NotificationTiming>;
  abstract save(timing: NotificationTiming): Promise<void>;
}
