import {
  bigint,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { EngineId } from "../../domain/engines.js";

/**
 * Successive readings of one Reading source that count (spec §5.4): the Office's tokens between
 * them and each window's change in percentage points, null for a window that reset or went down.
 */
export const usageWindowSamples = pgTable(
  "usage_window_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineId: text("engine_id").$type<EngineId>().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
    tokens: bigint("tokens", { mode: "number" }).notNull(),
    fiveHour: doublePrecision("five_hour"),
    sevenDay: doublePrecision("seven_day"),
  },
  (table) => [index("usage_window_samples_engine_read_at").on(table.engineId, table.readAt)],
);
