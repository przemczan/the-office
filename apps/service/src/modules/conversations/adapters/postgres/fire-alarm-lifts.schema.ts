import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { threads } from "./threads.schema.js";

/**
 * The Threads the user let their Agent act in while the fire alarm is on (spec §2.8), each for
 * the sounding it was lifted in: one lifted in an earlier sounding holds again.
 */
export const fireAlarmLifts = pgTable("fire_alarm_lifts", {
  threadId: uuid("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  alarmSince: timestamp("alarm_since", { withTimezone: true }).notNull(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }).notNull(),
});
