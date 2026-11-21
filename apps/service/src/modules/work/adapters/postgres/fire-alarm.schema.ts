import { sql } from "drizzle-orm";
import { boolean, check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import type { FireAlarmWay } from "../../domain/fire-alarm.js";

/**
 * The one fire alarm (spec §2.8), in one row seeded off; `since` is set exactly while it is on, and
 * `way` is how it was sounded, kept as the last way once it is off.
 */
export const fireAlarm = pgTable(
  "fire_alarm",
  {
    id: smallint("id").primaryKey().default(1),
    on: boolean("on").notNull(),
    since: timestamp("since", { withTimezone: true }),
    way: text("way").$type<FireAlarmWay>().notNull().default("asap"),
  },
  (table) => [
    check("fire_alarm_one_row", sql`${table.id} = 1`),
    check("fire_alarm_since_while_on", sql`${table.on} = (${table.since} IS NOT NULL)`),
  ],
);
