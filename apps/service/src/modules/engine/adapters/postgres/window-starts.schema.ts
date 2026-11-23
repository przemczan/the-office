import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { EngineId } from "../../domain/engines.js";
import type { WindowStartSkipReason, WindowStartTrigger } from "../../domain/window-starts.js";

/**
 * Each engine's Window start (spec §5.4.6): when it starts its 5-hour window by itself, and its
 * last start, skip or failure. No foreign key to `engines`: a Save of Settings › Engines deletes
 * and inserts every engine row again, so a cascade would wipe it; `PostgresEngineSettings`
 * deletes a removed engine's row in the same transaction.
 */
export const engineWindowStarts = pgTable("engine_window_starts", {
  engineId: text("engine_id").$type<EngineId>().primaryKey(),
  /** `HH:MM`, unique and sorted. */
  startAtTimes: text("start_at_times").array().notNull().default([]),
  startAfterReset: boolean("start_after_reset").notNull().default(false),
  lastAt: timestamp("last_at", { withTimezone: true }),
  lastOutcome: text("last_outcome").$type<"started" | "skipped" | "failed">(),
  lastReason: text("last_reason").$type<WindowStartSkipReason>(),
  lastError: text("last_error"),
  lastTrigger: text("last_trigger").$type<WindowStartTrigger>(),
  lastFiveHourResetsAt: timestamp("last_five_hour_resets_at", { withTimezone: true }),
});
