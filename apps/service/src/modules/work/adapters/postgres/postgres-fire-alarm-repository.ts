import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { FIRE_ALARM_OFF, type FireAlarm } from "../../domain/fire-alarm.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { fireAlarm } from "./fire-alarm.schema.js";

@Injectable()
export class PostgresFireAlarmRepository extends FireAlarmRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<FireAlarm> {
    const [row] = await this.database.select().from(fireAlarm).limit(1);
    return row?.on && row.since ? { on: true, since: row.since } : FIRE_ALARM_OFF;
  }

  async sound(since: Date): Promise<boolean> {
    const turnedOn = await this.database
      .update(fireAlarm)
      .set({ on: true, since })
      .where(eq(fireAlarm.on, false))
      .returning({ id: fireAlarm.id });
    return turnedOn.length > 0;
  }
}
