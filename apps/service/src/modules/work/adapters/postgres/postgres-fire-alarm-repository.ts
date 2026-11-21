import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  FIRE_ALARM_OFF,
  soundingOf,
  type FireAlarm,
  type FireAlarmSounding,
  type FireAlarmWay,
} from "../../domain/fire-alarm.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { fireAlarm } from "./fire-alarm.schema.js";

type FireAlarmRow = typeof fireAlarm.$inferSelect;

@Injectable()
export class PostgresFireAlarmRepository extends FireAlarmRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<FireAlarm> {
    const [row] = await this.database.select().from(fireAlarm).limit(1);
    return alarmOf(row);
  }

  async sound(since: Date, way: FireAlarmWay): Promise<FireAlarmSounding> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.select().from(fireAlarm).limit(1).for("update");
      const sounding = soundingOf(alarmOf(row), way);
      if (sounding === "turned-on") {
        await transaction.update(fireAlarm).set({ on: true, since, way });
      } else if (sounding === "made-stricter") {
        await transaction.update(fireAlarm).set({ way });
      }
      return sounding;
    });
  }

  async allClear(): Promise<boolean> {
    const turnedOff = await this.database
      .update(fireAlarm)
      .set({ on: false, since: null })
      .where(eq(fireAlarm.on, true))
      .returning({ id: fireAlarm.id });
    return turnedOff.length > 0;
  }
}

function alarmOf(row: FireAlarmRow | undefined): FireAlarm {
  return row?.on && row.since ? { on: true, since: row.since, way: row.way } : FIRE_ALARM_OFF;
}
