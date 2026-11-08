import { sql } from "drizzle-orm";
import { check, integer, pgTable, real, smallint } from "drizzle-orm/pg-core";

/**
 * The Office-wide settings of run environments (spec §5.5, "Limits"), in one row once Settings
 * saves them; until then the repository answers the defaults.
 */
export const runEnvironmentSettings = pgTable(
  "run_environment_settings",
  {
    id: smallint("id").primaryKey().default(1),
    cpus: real("cpus").notNull(),
    memoryMegabytes: integer("memory_megabytes").notNull(),
    processes: integer("processes").notNull(),
    runEnvironmentsAtOnce: integer("run_environments_at_once").notNull(),
  },
  (table) => [
    check("run_environment_settings_one_row", sql`${table.id} = 1`),
    check("run_environment_settings_cpus", sql`${table.cpus} > 0`),
    check("run_environment_settings_memory", sql`${table.memoryMegabytes} > 0`),
    check("run_environment_settings_processes", sql`${table.processes} > 0`),
    check("run_environment_settings_at_once", sql`${table.runEnvironmentsAtOnce} > 0`),
  ],
);
