import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, smallint, text } from "drizzle-orm/pg-core";
import type { ApiEndpointModel } from "../../domain/api-endpoints.js";

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
