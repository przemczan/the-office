import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
} from "drizzle-orm/pg-core";
import type { ApiEndpointModel } from "../../domain/api-endpoints.js";
import type { EngineId } from "../../domain/engines.js";

/** The API endpoints Settings › Engines lists, in its order. */
export const apiEndpoints = pgTable(
  "api_endpoints",
  {
    id: text("id").primaryKey(),
    position: integer("position").notNull().unique(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    /** Empty when the server asks for none. */
    key: text("key").notNull(),
    models: jsonb("models").$type<readonly ApiEndpointModel[]>().notNull(),
  },
  (table) => [check("api_endpoints_id", sql`${table.id} <> ''`)],
);

/** The rest of the engines' settings, in one row once Settings saves them. */
export const engineSettings = pgTable(
  "engine_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** Null until the user sets the search endpoint. */
    searchEndpointUrl: text("search_endpoint_url"),
  },
  (table) => [check("engine_settings_one_row", sql`${table.id} = 1`)],
);

/** Each priced model's Model price, in dollars per million tokens; a model with no row has none. */
export const modelPrices = pgTable(
  "model_prices",
  {
    engineId: text("engine_id").$type<EngineId>().notNull(),
    model: text("model").notNull(),
    input: numeric("input", { mode: "number" }).notNull(),
    output: numeric("output", { mode: "number" }).notNull(),
    cacheWrites: numeric("cache_writes", { mode: "number" }).notNull(),
    cacheReads: numeric("cache_reads", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.engineId, table.model] }),
    check(
      "model_prices_not_negative",
      sql`${table.input} >= 0 AND ${table.output} >= 0 AND ${table.cacheWrites} >= 0 AND ${table.cacheReads} >= 0`,
    ),
  ],
);
