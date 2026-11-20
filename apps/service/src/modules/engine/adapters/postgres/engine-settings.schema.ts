import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { ApiEndpointModel } from "../../domain/api-endpoints.js";
import {
  DEFAULT_ASK_BEFORE_SWITCH_ABOVE,
  FIRST_OFFICE_DEFAULT,
} from "../../domain/engine-settings.js";
import type { EngineId, EngineKind } from "../../domain/engines.js";

/**
 * The engines Settings › Engines lists, in its order. The `-p` switch is a Claude Code engine's;
 * the base URL, key and models an API engine's, null on the other kinds, but for a Codex engine's
 * key, the OpenAI API key it is signed in with, and a Copilot CLI engine's, the token pasted into
 * it: null when none is (never empty).
 */
export const engines = pgTable(
  "engines",
  {
    id: text("id").primaryKey(),
    position: integer("position").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").$type<EngineKind>().notNull(),
    defaultModel: text("default_model").notNull(),
    claudeCodeP: boolean("claude_code_p").notNull().default(false),
    baseUrl: text("base_url"),
    /** Empty when the server asks for none. */
    key: text("key"),
    models: jsonb("models").$type<readonly ApiEndpointModel[]>(),
  },
  (table) => [
    check("engines_id", sql`${table.id} <> ''`),
    check(
      "engines_kind",
      sql`(${table.kind} = 'claude-code' AND ${table.baseUrl} IS NULL AND ${table.key} IS NULL AND ${table.models} IS NULL) OR (${table.kind} = 'openai-compatible-api' AND ${table.baseUrl} IS NOT NULL AND ${table.key} IS NOT NULL AND ${table.models} IS NOT NULL AND NOT ${table.claudeCodeP}) OR (${table.kind} = 'codex' AND ${table.baseUrl} IS NULL AND ${table.models} IS NULL AND NOT ${table.claudeCodeP} AND (${table.key} IS NULL OR ${table.key} <> '')) OR (${table.kind} = 'copilot-cli' AND ${table.baseUrl} IS NULL AND ${table.models} IS NULL AND NOT ${table.claudeCodeP} AND (${table.key} IS NULL OR ${table.key} <> '')) OR (${table.kind} = 'gemini-cli' AND ${table.baseUrl} IS NULL AND ${table.models} IS NULL AND NOT ${table.claudeCodeP} AND (${table.key} IS NULL OR ${table.key} <> ''))`,
    ),
  ],
);

/** The rest of the engines' settings, in one row once Settings saves them. */
export const engineSettings = pgTable(
  "engine_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** Null until the user sets the search endpoint. */
    searchEndpointUrl: text("search_endpoint_url"),
    /** The Office default: an engine and one of its models, both null while no engine is listed. */
    officeDefaultEngineId: text("office_default_engine_id")
      .$type<EngineId>()
      .default(FIRST_OFFICE_DEFAULT.engineId),
    officeDefaultModel: text("office_default_model").default(FIRST_OFFICE_DEFAULT.model),
    /** The Stand-in Engines in order; an id no longer listed is left out as it is read. */
    standInEngineIds: text("stand_in_engine_ids")
      .$type<EngineId>()
      .array()
      .notNull()
      .default(sql`'{}'`),
    askBeforeSwitchAbove: integer("ask_before_switch_above")
      .notNull()
      .default(DEFAULT_ASK_BEFORE_SWITCH_ABOVE),
  },
  (table) => [
    check("engine_settings_one_row", sql`${table.id} = 1`),
    check(
      "engine_settings_office_default_whole",
      sql`(${table.officeDefaultEngineId} IS NULL) = (${table.officeDefaultModel} IS NULL)`,
    ),
    check("engine_settings_ask_before_switch_above", sql`${table.askBeforeSwitchAbove} >= 0`),
  ],
);

/**
 * Each priced model's Model price, in dollars per million tokens; a model with no row has none. A
 * Claude model's engine id is null, its price shared by every Claude Code engine, and so is a Codex
 * model's, shared by every Codex engine.
 */
export const modelPrices = pgTable(
  "model_prices",
  {
    engineId: text("engine_id").$type<EngineId>(),
    model: text("model").notNull(),
    input: numeric("input", { mode: "number" }).notNull(),
    output: numeric("output", { mode: "number" }).notNull(),
    cacheWrites: numeric("cache_writes", { mode: "number" }).notNull(),
    cacheReads: numeric("cache_reads", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("model_prices_engine_model").on(table.engineId, table.model).nullsNotDistinct(),
    check(
      "model_prices_not_negative",
      sql`${table.input} >= 0 AND ${table.output} >= 0 AND ${table.cacheWrites} >= 0 AND ${table.cacheReads} >= 0`,
    ),
  ],
);
