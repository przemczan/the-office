import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_TIMING, type NotificationTiming } from "../../domain/notification-timing.js";
import { NotificationTimingRepository } from "../../ports/notification-timing-repository.js";
import { notificationTiming } from "./notifications.schema.js";

@Injectable()
export class PostgresNotificationTimingRepository extends NotificationTimingRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<NotificationTiming> {
    const [row] = await this.database.select().from(notificationTiming).limit(1);
    if (!row) return DEFAULT_TIMING;
    const { holdPhoneMinutes, awayMinutes, batchOutcomesMinutes, quietFrom, quietTo } = row;
    return {
      holdPhoneMinutes,
      awayMinutes,
      batchOutcomesMinutes,
      quietHours:
        quietFrom !== null && quietTo !== null ? { from: quietFrom, to: quietTo } : undefined,
    };
  }

  async save({ quietHours, ...minutes }: NotificationTiming): Promise<void> {
    const row = {
      ...minutes,
      quietFrom: quietHours?.from ?? null,
      quietTo: quietHours?.to ?? null,
    };
    await this.database
      .insert(notificationTiming)
      .values(row)
      .onConflictDoUpdate({ target: notificationTiming.id, set: row });
  }
}
