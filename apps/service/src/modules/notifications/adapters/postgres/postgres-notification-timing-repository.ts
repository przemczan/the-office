import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_TIMING, type NotificationTiming } from "../../domain/notification-timing.js";
import { NotificationTimingRepository } from "../../ports/notification-timing-repository.js";
import { userNotificationTiming } from "./notifications.schema.js";

@Injectable()
export class PostgresNotificationTimingRepository extends NotificationTimingRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(userId: string): Promise<NotificationTiming> {
    const [row] = await this.database
      .select()
      .from(userNotificationTiming)
      .where(eq(userNotificationTiming.userId, userId));
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

  async save(userId: string, { quietHours, ...minutes }: NotificationTiming): Promise<void> {
    const row = {
      ...minutes,
      quietFrom: quietHours?.from ?? null,
      quietTo: quietHours?.to ?? null,
    };
    await this.database
      .insert(userNotificationTiming)
      .values({ userId, ...row })
      .onConflictDoUpdate({ target: userNotificationTiming.userId, set: row });
  }
}
