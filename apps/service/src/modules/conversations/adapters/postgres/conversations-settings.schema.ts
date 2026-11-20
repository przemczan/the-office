import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint } from "drizzle-orm/pg-core";

/**
 * The Office settings Conversations reads, in one row once Settings saves them; until then the
 * repository answers each default.
 */
export const conversationsSettings = pgTable(
  "conversations_settings",
  {
    id: smallint("id").primaryKey().default(1),
    sizeThreshold: integer("size_threshold").notNull(),
    /** The Office defaults of every Agent Stage's context limits (spec §2.5). */
    stageSoftLimit: integer("stage_soft_limit").notNull().default(100_000),
    stageHardLimit: integer("stage_hard_limit").notNull().default(180_000),
  },
  (table) => [
    check("conversations_settings_one_row", sql`${table.id} = 1`),
    check("conversations_settings_size_threshold", sql`${table.sizeThreshold} > 0`),
    check(
      "conversations_settings_stage_limits",
      sql`${table.stageSoftLimit} > 0 and ${table.stageHardLimit} > ${table.stageSoftLimit}`,
    ),
  ],
);
