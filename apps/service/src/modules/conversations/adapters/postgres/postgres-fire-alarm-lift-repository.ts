import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { FireAlarmLiftRepository } from "../../ports/fire-alarm-lift-repository.js";
import { fireAlarmLifts } from "./fire-alarm-lifts.schema.js";

@Injectable()
export class PostgresFireAlarmLiftRepository extends FireAlarmLiftRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async lift(threadId: string, alarmSince: Date, liftedAt: Date): Promise<void> {
    await this.database
      .insert(fireAlarmLifts)
      .values({ threadId, alarmSince, liftedAt })
      .onConflictDoUpdate({ target: fireAlarmLifts.threadId, set: { alarmSince, liftedAt } });
  }

  async takeBack(threadId: string): Promise<boolean> {
    const taken = await this.database
      .delete(fireAlarmLifts)
      .where(eq(fireAlarmLifts.threadId, threadId))
      .returning({ threadId: fireAlarmLifts.threadId });
    return taken.length > 0;
  }

  async liftedIn(alarmSince: Date): Promise<readonly string[]> {
    const rows = await this.database
      .select({ threadId: fireAlarmLifts.threadId })
      .from(fireAlarmLifts)
      .where(eq(fireAlarmLifts.alarmSince, alarmSince));
    return rows.map(({ threadId }) => threadId);
  }
}
