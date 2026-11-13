import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { GatheringKind, Pointer } from "../../domain/notification.js";
import type { Channel, NotificationKind } from "../../domain/notification-kinds.js";
import type { TaskOutcomeKind } from "../../domain/task-outcome.js";

/** Each outcome of a started Task, as it happened. */
export const taskOutcomes = pgTable(
  "task_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    outcome: text("outcome").$type<TaskOutcomeKind>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("task_outcomes_occurred_at").on(table.occurredAt)],
);

/** Each user's activity, once they are first seen: where their Since you left begins. */
export const userActivity = pgTable("user_activity", {
  userId: text("user_id").primaryKey(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }).notNull(),
});

/** Each Thread's tokens so far at its last count, which the next count is measured from. */
export const threadTokenCounts = pgTable("thread_token_counts", {
  threadId: uuid("thread_id").primaryKey(),
  ...tokenKindColumns(),
});

/** The tokens counted on each day, by kind. */
export const dayTokens = pgTable("day_tokens", {
  day: date("day", { mode: "string" }).primaryKey(),
  ...tokenKindColumns(),
});

function tokenKindColumns() {
  return {
    input: bigint("input", { mode: "number" }).notNull(),
    output: bigint("output", { mode: "number" }).notNull(),
    cacheRead: bigint("cache_read", { mode: "number" }).notNull(),
    cacheCreation: bigint("cache_creation", { mode: "number" }).notNull(),
  };
}

/** The Tasks with a Stage run on each day. */
export const tasksTouched = pgTable(
  "tasks_touched",
  {
    day: date("day", { mode: "string" }).notNull(),
    taskId: uuid("task_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.taskId] })],
);

/** Each Notification raised; cleared once the user handled what it points to. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").$type<NotificationKind | GatheringKind>().notNull(),
    /** Who speaks; null when The Office does. */
    roleKey: text("role_key"),
    line: text("line").notNull(),
    pointsTo: jsonb("points_to").$type<Pointer>().notNull(),
    channels: jsonb("channels").$type<readonly Channel[]>().notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    /** The Notifications it stands for, when it gathers others. */
    gathers: jsonb("gathers").$type<readonly string[]>().notNull().default([]),
    /** The channels quiet hours hold it from, until their summary goes. */
    held: jsonb("held").$type<readonly Channel[]>().notNull().default([]),
    phonePushedAt: timestamp("phone_pushed_at", { withTimezone: true }),
  },
  (table) => [index("notifications_cleared_at").on(table.clearedAt)],
);

/**
 * The routing, a row per level and channel it sets; a level with no row for a channel takes it
 * from the level above. The migration that made it stored ticket 20's defaults.
 */
export const notificationRouting = pgTable(
  "notification_routing",
  {
    level: text("level").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    on: boolean("on").notNull(),
  },
  (table) => [primaryKey({ columns: [table.level, table.channel] })],
);

/**
 * When Notifications reach the desktop and the phone, in one row; quiet hours are off while both
 * their ends are null. The migration that made it stored ticket 20's defaults.
 */
export const notificationTiming = pgTable(
  "notification_timing",
  {
    id: smallint("id").primaryKey().default(1),
    holdPhoneMinutes: smallint("hold_phone_minutes").notNull(),
    awayMinutes: smallint("away_minutes").notNull(),
    batchOutcomesMinutes: smallint("batch_outcomes_minutes").notNull(),
    quietFrom: text("quiet_from"),
    quietTo: text("quiet_to"),
  },
  (table) => [
    check("notification_timing_one_row", sql`${table.id} = 1`),
    check(
      "notification_timing_quiet_hours_both_ends",
      sql`(${table.quietFrom} IS NULL) = (${table.quietTo} IS NULL)`,
    ),
  ],
);
