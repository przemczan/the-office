import { sql } from "drizzle-orm";
import { boolean, check, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

/** The one fire alarm (spec §2.8), in one row seeded off; `since` is set exactly while it is on. */
export const fireAlarm = pgTable(
  "fire_alarm",
  {
    id: smallint("id").primaryKey().default(1),
    on: boolean("on").notNull(),
    since: timestamp("since", { withTimezone: true }),
  },
  (table) => [
    check("fire_alarm_one_row", sql`${table.id} = 1`),
    check("fire_alarm_since_while_on", sql`${table.on} = (${table.since} IS NOT NULL)`),
  ],
);
