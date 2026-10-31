import { z } from "zod";

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

/** GET and PUT /settings/engines: the Office-wide settings of the engines. */
export const engineSettingsSchema = z.object({
  apiEndpoints: z.array(apiEndpointSchema),
  /** Null until the user sets one; WebSearch is refused meanwhile. */
  searchEndpoint: searchEndpointSchema.nullable(),
});
export type EngineSettings = z.infer<typeof engineSettingsSchema>;

/**
 * An API endpoint as Settings › Engines saves it: without an `id` when it is new. Without a `key`
 * it keeps the one kept; an empty key means none, as on a local server.
 */
export const apiEndpointEditSchema = apiEndpointSchema
  .omit({ id: true, keySet: true })
  .extend({ id: z.string().optional(), key: z.string().optional() });
export type ApiEndpointEdit = z.infer<typeof apiEndpointEditSchema>;

/** PUT /settings/engines: every API endpoint, in order, and the search endpoint. */
export const engineSettingsEditSchema = z.object({
  apiEndpoints: z.array(apiEndpointEditSchema),
  searchEndpoint: searchEndpointSchema.nullable(),
});
export type EngineSettingsEdit = z.infer<typeof engineSettingsEditSchema>;

export const engineSettingsRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type EngineSettingsRefusal = z.infer<typeof engineSettingsRefusalSchema>;
