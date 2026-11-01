import { sql } from "drizzle-orm";
import { bigint, check, integer, numeric, pgTable, smallint, text } from "drizzle-orm/pg-core";
import type { EngineId } from "../../../engine/index.js";
import type { UsageMeasure } from "../../domain/usage-estimate.js";

/**
 * The Office settings Work reads, in one row once Settings saves one of them; until then, and for
 * each one null, the repository answers its default.
 */
export const workSettings = pgTable(
  "work_settings",
  {
    id: smallint("id").primaryKey().default(1),
    officeWideLimit: integer("office_wide_limit"),
    usageMeasures: text("usage_measures").array().$type<UsageMeasure[]>(),
  },
  (table) => [
    check("work_settings_one_row", sql`${table.id} = 1`),
    check("work_settings_office_wide_limit", sql`${table.officeWideLimit} > 0`),
  ],
);

/**
 * The caps on each engine id once Settings saves them, each null when off; an engine id with no
 * row has its default caps. Window caps are in % of the window.
 */
export const engineCaps = pgTable(
  "engine_caps",
  {
    engineId: text("engine_id").$type<EngineId>().primaryKey(),
    fiveHourWindow: smallint("five_hour_window"),
    sevenDayWindow: smallint("seven_day_window"),
    dailyTokens: bigint("daily_tokens", { mode: "number" }),
    dailyDollars: numeric("daily_dollars", { mode: "number" }),
  },
  (table) => [
    check(
      "engine_caps_windows",
      sql`${table.fiveHourWindow} BETWEEN 1 AND 100 AND ${table.sevenDayWindow} BETWEEN 1 AND 100`,
    ),
    check("engine_caps_daily", sql`${table.dailyTokens} > 0 AND ${table.dailyDollars} > 0`),
  ],
);
