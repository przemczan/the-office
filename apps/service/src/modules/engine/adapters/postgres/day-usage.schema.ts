import { bigint, date, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { EngineId } from "../../domain/engines.js";

/** What each model on each engine used each day, kind by kind, from local midnight. */
export const engineDayUsage = pgTable(
  "engine_day_usage",
  {
    day: date("day", { mode: "string" }).notNull(),
    engineId: text("engine_id").$type<EngineId>().notNull(),
    model: text("model").notNull(),
    input: bigint("input", { mode: "number" }).notNull(),
    output: bigint("output", { mode: "number" }).notNull(),
    cacheRead: bigint("cache_read", { mode: "number" }).notNull(),
    cacheCreation: bigint("cache_creation", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.engineId, table.model] })],
);
