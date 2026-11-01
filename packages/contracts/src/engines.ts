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

/**
 * A server on the OpenAI-compatible API, as Settings › Engines lists it. Its `id` is made from
 * the name when it is added and kept when it is renamed: a Role's Model field names it.
 */
export const apiEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  /** The key itself is never sent back. */
  keySet: z.boolean(),
  models: z.array(apiEndpointModelSchema),
});
export type ApiEndpoint = z.infer<typeof apiEndpointSchema>;

/** The web search WebSearch goes through for the OpenAI-compatible API: SearXNG's JSON API. */
export const searchEndpointSchema = z.object({ baseUrl: z.string() });
export type SearchEndpoint = z.infer<typeof searchEndpointSchema>;

/**
 * What an engine spends on: both Claude Code engines spend one account's credits, so they share
 * `claude-code`. Caps, readings, each day's use and Model prices are kept by it.
 */
export const engineIdSchema = z.enum(["claude-code", "openai-compatible-api"]);
export type EngineId = z.infer<typeof engineIdSchema>;

/**
 * Whether the account behind `engineId` has usage windows, and so Window caps: only the Claude Code
 * account's (spec §5.4). Mirrors the service's `hasUsageWindows`.
 */
export function engineIdHasUsageWindows(engineId: EngineId): boolean {
  return engineId === "claude-code";
}

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
 * A model offered on an engine id, as its Model field names it (`<endpoint id>/<model id>` on the
 * API), with its Model price; null when it has none, which gives "no cost".
 */
export const offeredModelSchema = z.object({
  engineId: engineIdSchema,
  model: z.string(),
  price: modelPriceSchema.nullable(),
});
export type OfferedModel = z.infer<typeof offeredModelSchema>;

/** GET and PUT /settings/engines: the Office-wide settings of the engines. */
export const engineSettingsSchema = z.object({
  apiEndpoints: z.array(apiEndpointSchema),
  /** Null until the user sets one; WebSearch is refused meanwhile. */
  searchEndpoint: searchEndpointSchema.nullable(),
  /** Every model offered now, the Claude Code engines' first, then each API endpoint's. */
  modelPrices: z.array(offeredModelSchema),
});
export type EngineSettings = z.infer<typeof engineSettingsSchema>;

/**
 * An API endpoint as Settings › Engines saves it: without an `id` when it is new. Without a `key`
 * it keeps the one kept; an empty key means none, as on a local server. A context window that
 * isn't a positive whole number is refused with words (422), not by the contract.
 */
export const apiEndpointEditSchema = apiEndpointSchema
  .omit({ id: true, keySet: true, models: true })
  .extend({
    id: z.string().optional(),
    key: z.string().optional(),
    models: z.array(apiEndpointModelSchema.extend({ contextWindow: z.number() })),
  });
export type ApiEndpointEdit = z.infer<typeof apiEndpointEditSchema>;

/**
 * PUT /settings/engines: every API endpoint, in order, the search endpoint and the Model prices.
 * A price of a model the saved API endpoints no longer offer is dropped.
 */
export const engineSettingsEditSchema = z.object({
  apiEndpoints: z.array(apiEndpointEditSchema),
  searchEndpoint: searchEndpointSchema.nullable(),
  modelPrices: z.array(offeredModelSchema),
});
export type EngineSettingsEdit = z.infer<typeof engineSettingsEditSchema>;

/**
 * The API endpoint and the model a Role's Model field names on the OpenAI-compatible API
 * (`strata/org/coder:q4`), split at the first `/` as the Engine module splits it; undefined when
 * it names no endpoint.
 */
export function parseApiEndpointModel(
  model: string,
): { readonly endpointId: string; readonly modelId: string } | undefined {
  const at = model.indexOf("/");
  if (at <= 0 || at === model.length - 1) return undefined;
  return { endpointId: model.slice(0, at), modelId: model.slice(at + 1) };
}

/** An API endpoint's model as a Role's Model field names it: `strata/org/coder:q4`. */
export function apiEndpointModel(endpointId: string, modelId: string): string {
  return `${endpointId}/${modelId}`;
}

/**
 * The id the Engine module gives an API endpoint added as `name` (its `apiEndpointIdFor`): its
 * letters and digits, apart from `taken`. The web names a drafted endpoint's models by it, so a
 * Model price typed before Save lands on the model the service saves.
 */
export function apiEndpointIdFor(name: string, taken: ReadonlySet<string>): string {
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
