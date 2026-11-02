import { z } from "zod";

/** What an engine can do beyond starting a session and taking messages; the Role card names those it can't. */
export const engineCapabilitySchema = z.enum([
  "bargeIn",
  "interrupt",
  "resume",
  "usageWindows",
  "contextUsage",
  "officeTools",
  "outputSchema",
]);
export type EngineCapability = z.infer<typeof engineCapabilitySchema>;

/** A model an API endpoint serves, by its id there, with how many tokens its context holds. */
export const apiEndpointModelSchema = z.object({
  id: z.string(),
  contextWindow: z.int().positive(),
});
export type ApiEndpointModel = z.infer<typeof apiEndpointModelSchema>;

/** The web search WebSearch goes through for the OpenAI-compatible API: SearXNG's JSON API. */
export const searchEndpointSchema = z.object({ baseUrl: z.string() });
export type SearchEndpoint = z.infer<typeof searchEndpointSchema>;

/**
 * An engine's id, made from its name when it is added and kept on a rename: caps, readings, each
 * day's use and Model prices are kept by it.
 */
export const engineIdSchema = z.string().min(1);
export type EngineId = z.infer<typeof engineIdSchema>;

/** A Claude Code account, which may run on the `-p` fallback instead of the Agent SDK. */
export const claudeCodeEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("claude-code"),
  /** One of the Claude models, which picking the engine fills in. */
  defaultModel: z.string(),
  claudeCodeP: z.boolean(),
});
export type ClaudeCodeEngine = z.infer<typeof claudeCodeEngineSchema>;

/** An API endpoint of the OpenAI-compatible API. */
export const apiEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("openai-compatible-api"),
  /** One of its models, by its id there. */
  defaultModel: z.string(),
  baseUrl: z.string(),
  /** The key itself is never sent back. */
  keySet: z.boolean(),
  models: z.array(apiEndpointModelSchema),
});
export type ApiEngine = z.infer<typeof apiEngineSchema>;

/** An engine the user lists in Settings › Engines (spec §5.4). */
export const engineSchema = z.discriminatedUnion("kind", [claudeCodeEngineSchema, apiEngineSchema]);
export type Engine = z.infer<typeof engineSchema>;
export type EngineKind = Engine["kind"];

/** An engine and one of its models, by its id there. */
export const engineModelSchema = z.object({ engineId: engineIdSchema, model: z.string() });
export type EngineModel = z.infer<typeof engineModelSchema>;

/**
 * What a model costs, in dollars per million tokens of each kind. A negative price is refused
 * with words (422), not by the contract.
 */
export const modelPriceSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheWrites: z.number(),
  cacheReads: z.number(),
});
export type ModelPrice = z.infer<typeof modelPriceSchema>;

/**
 * A model that may be priced, with its Model price; null when it has none, which gives "no cost".
 * A Claude model's `engineId` is null: its price is shared by every Claude Code engine. An API
 * engine's model is priced on that engine.
 */
export const offeredModelSchema = z.object({
  engineId: engineIdSchema.nullable(),
  model: z.string(),
  price: modelPriceSchema.nullable(),
});
export type OfferedModel = z.infer<typeof offeredModelSchema>;

/** GET and PUT /settings/engines: the Office-wide settings of the engines. */
export const engineSettingsSchema = z.object({
  /** In the order Settings › Engines lists them. */
  engines: z.array(engineSchema),
  /** The engine and model every Role runs on unless something more specific applies. */
  officeDefault: engineModelSchema,
  /** Null until the user sets one; WebSearch is refused meanwhile. */
  searchEndpoint: searchEndpointSchema.nullable(),
  /** Every model offered now: the Claude models first, then each API engine's. */
  modelPrices: z.array(offeredModelSchema),
});
export type EngineSettings = z.infer<typeof engineSettingsSchema>;

/** A Claude Code engine as Settings › Engines saves it: without an `id` when it is new. */
export const claudeCodeEngineEditSchema = claudeCodeEngineSchema.extend({
  id: engineIdSchema.optional(),
});
export type ClaudeCodeEngineEdit = z.infer<typeof claudeCodeEngineEditSchema>;

/**
 * An API engine as Settings › Engines saves it: without an `id` when it is new. Without a `key` it
 * keeps the one kept; an empty key means none, as on a local server. A context window that isn't
 * a positive whole number is refused with words (422), not by the contract.
 */
export const apiEngineEditSchema = apiEngineSchema.omit({ keySet: true, models: true }).extend({
  id: engineIdSchema.optional(),
  key: z.string().optional(),
  models: z.array(apiEndpointModelSchema.extend({ contextWindow: z.number() })),
});
export type ApiEngineEdit = z.infer<typeof apiEngineEditSchema>;

export const engineEditSchema = z.discriminatedUnion("kind", [
  claudeCodeEngineEditSchema,
  apiEngineEditSchema,
]);
export type EngineEdit = z.infer<typeof engineEditSchema>;

/**
 * PUT /settings/engines: every engine, in order, the Office default, the search endpoint and the
 * Model prices. An engine left out is removed. A price of a model the saved engines no longer
 * offer is dropped.
 */
export const engineSettingsEditSchema = z.object({
  engines: z.array(engineEditSchema),
  officeDefault: engineModelSchema,
  searchEndpoint: searchEndpointSchema.nullable(),
  modelPrices: z.array(offeredModelSchema),
});
export type EngineSettingsEdit = z.infer<typeof engineSettingsEditSchema>;

/**
 * The id the Engine module gives an engine added as `name` (its `engineIdFor`): its letters and
 * digits, apart from `taken`. The web names a drafted engine's models by it, so a Model price typed
 * before Save lands on the model the service saves.
 */
export function engineIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .trim()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (base === "" || !taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export const engineSettingsRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type EngineSettingsRefusal = z.infer<typeof engineSettingsRefusalSchema>;
