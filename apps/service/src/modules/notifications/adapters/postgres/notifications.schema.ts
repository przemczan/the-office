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
    /** The Stage a failure is of; null for any other outcome, and for one kept before it was. */
    stageName: text("stage_name"),
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

/**
 * Each Notification raised, shared by every user unless it is one user's own; cleared once the
 * user handled what it points to. How it reaches each user is in `notification_deliveries`.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").$type<NotificationKind | GatheringKind>().notNull(),
    /** Who speaks; null when The Office does. */
    roleKey: text("role_key"),
    line: text("line").notNull(),
    /** The line cut to fit the status strip, for the kinds that have one. */
    shortLine: text("short_line"),
    /**
     * The instant its lines name where they hold `{time}`, worded by each reader's time zone; null
     * when they name none, and for those raised before the column (2026-11-16), worded already.
     */
    at: timestamp("at", { withTimezone: true }),
    pointsTo: jsonb("points_to").$type<Pointer>().notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    /** The Notifications it stands for, when it gathers others. */
    gathers: jsonb("gathers").$type<readonly string[]>().notNull().default([]),
    /**
     * The one user it is for, by id, when it gathers what their batching or quiet hours held; null
     * when shared.
     */
    forUser: text("for_user"),
    /**
     * The office-wide channels, held and phone push of the release before 2026-11-22, which reads
     * them; nothing writes them since `notification_deliveries` keeps them for each user. Drop
     * them in a later release.
     */
    channels: jsonb("channels").$type<readonly Channel[]>().notNull().default([]),
    held: jsonb("held").$type<readonly Channel[]>().notNull().default([]),
    phonePushedAt: timestamp("phone_pushed_at", { withTimezone: true }),
  },
  (table) => [index("notifications_cleared_at").on(table.clearedAt)],
);

/**
 * How each Notification reaches each user its routing gives a channel: none for a user with
 * nothing routed.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channels: jsonb("channels").$type<readonly Channel[]>().notNull(),
    /** The channels the user's quiet hours hold it from, until their summary goes. */
    held: jsonb("held").$type<readonly Channel[]>().notNull().default([]),
    phonePushedAt: timestamp("phone_pushed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.notificationId, table.userId] }),
    index("notification_deliveries_user_id").on(table.userId),
  ],
);

/**
 * The office-wide routing of the release before 2026-11-22, which reads it; each user's is in
 * `user_notification_routing` since, seeded from it. Drop it in a later release.
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
 * Each user's routing, a row per level and channel they set; a level with no row for a channel
 * takes it from the level above, and a user with no row at all has spec 2.7's defaults.
 */
export const userNotificationRouting = pgTable(
  "user_notification_routing",
  {
    userId: text("user_id").notNull(),
    level: text("level").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    on: boolean("on").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.level, table.channel] })],
);

/**
 * Each user's timing, a row once they set it, spec 2.7's defaults until then; quiet hours are off
 * while both their ends are null.
 */
export const userNotificationTiming = pgTable(
  "user_notification_timing",
  {
    userId: text("user_id").primaryKey(),
    holdPhoneMinutes: smallint("hold_phone_minutes").notNull(),
    awayMinutes: smallint("away_minutes").notNull(),
    batchOutcomesMinutes: smallint("batch_outcomes_minutes").notNull(),
    quietFrom: text("quiet_from"),
    quietTo: text("quiet_to"),
  },
  (table) => [
    check(
      "user_notification_timing_quiet_hours_both_ends",
      sql`(${table.quietFrom} IS NULL) = (${table.quietTo} IS NULL)`,
    ),
  ],
);

/**
 * The office-wide timing of the release before 2026-11-22, which reads it, in one row; each
 * user's is in `user_notification_timing` since, seeded from it. Drop it in a later release.
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
