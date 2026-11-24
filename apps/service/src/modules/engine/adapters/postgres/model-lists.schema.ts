import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { EngineId } from "../../domain/engines.js";

/**
 * The models each engine's account listed when last asked (spec §5.4.5, "Models an engine
 * lists"). No foreign key to `engines`: a Save of Settings › Engines deletes and inserts every
 * engine row again, so a cascade would wipe it; `PostgresEngineSettings` deletes a removed
 * engine's row in the same transaction.
 */
export const engineModelLists = pgTable("engine_model_lists", {
  engineId: text("engine_id").$type<EngineId>().primaryKey(),
  /** By their ids, in the order the engine listed them; never empty. */
  models: jsonb("models").$type<string[]>().notNull(),
  listedAt: timestamp("listed_at", { withTimezone: true }).notNull(),
});
