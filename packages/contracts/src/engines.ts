import { z } from "zod";
import { webEventSchema } from "./events.js";

/** What an engine can do beyond starting a session and taking messages; the Role card names those it can't. */
export const engineCapabilitySchema = z.enum([
  "bargeIn",
  "interrupt",
  "resume",
  "usageWindows",
  "contextUsage",
  "officeTools",
  "outputSchema",
  "languageServers",
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
  /**
   * The engine and model every Role runs on unless something more specific applies; null only
   * while no engine is listed, the only one removed.
   */
  officeDefault: engineModelSchema.nullable(),
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
 * Model prices. A saved engine left out is refused (422): DELETE /settings/engines/:engineId removes
 * one. A price of a model the saved engines no longer offer is dropped.
 */
export const engineSettingsEditSchema = z.object({
  engines: z.array(engineEditSchema),
  /** Null only with no engine listed; with any listed, one is picked (422 otherwise). */
  officeDefault: engineModelSchema.nullable(),
  searchEndpoint: searchEndpointSchema.nullable(),
  modelPrices: z.array(offeredModelSchema),
});
export type EngineSettingsEdit = z.infer<typeof engineSettingsEditSchema>;

/**
 * DELETE /settings/engines/:engineId?replacement=<engine id>: the engine that takes over everything
 * naming the removed one; the answer is the settings left, as GET gives them. Without a replacement
 * the only engine is removed and every reference moves to none, so no session starts until an
 * engine is added. A replacement not listed, none while other engines are, or one failing the
 * capability check, is refused with words (422).
 */
export const engineRemovalSchema = z.object({
  replacement: engineIdSchema.optional(),
});
export type EngineRemoval = z.infer<typeof engineRemovalSchema>;

/**
 * A level naming the engine being removed, where it stands and where the removal puts it (none
 * when the only engine goes). What it belongs to tells the level: a Role and a Project for a
 * Project's Role override, a Project alone for its Project default, a Role alone for its Role
 * override, neither for the Office default.
 */
export const movedEngineReferenceSchema = z.object({
  roleKey: z.string().nullable(),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  from: engineModelSchema,
  to: engineModelSchema.nullable(),
});
export type MovedEngineReference = z.infer<typeof movedEngineReferenceSchema>;

/**
 * GET /settings/engines/:engineId/removal?replacement=<engine id>: what DELETE with the same
 * replacement would do, doing nothing. `problems` holds the words it would be refused with (the
 * capability check), none when it would go through. An engine or replacement not listed, or none
 * while other engines are, is refused as DELETE refuses it (422).
 */
export const engineRemovalPreviewSchema = z.object({
  moves: z.array(movedEngineReferenceSchema),
  problems: z.array(z.string()),
});
export type EngineRemovalPreview = z.infer<typeof engineRemovalPreviewSchema>;

/**
 * GET /settings/engines/:engineId/account: a Claude Code engine's account as `claude auth status`
 * gives it, the email and plan null when signed out, signed in by a pasted token, or not told.
 */
export const engineAccountSchema = z.object({
  signedIn: z.boolean(),
  /** A token pasted with "Paste a token instead" signs it in, not a Sign in. */
  pastedToken: z.boolean(),
  email: z.string().nullable(),
  /** The Claude subscription, such as `max` or `pro`. */
  plan: z.string().nullable(),
});
export type EngineAccount = z.infer<typeof engineAccountSchema>;

/**
 * POST /settings/engines/:engineId/sign-in: the Sign in started. Where there is a display the
 * browser opens by itself; this page signs in from any browser and gives a code to paste back.
 */
export const engineSignInSchema = z.object({ url: z.url() });
export type EngineSignIn = z.infer<typeof engineSignInSchema>;

/** POST /settings/engines/:engineId/sign-in/code: the code the sign-in page gave. */
export const engineSignInCodeSchema = z.object({ code: z.string().trim().min(1) });
export type EngineSignInCode = z.infer<typeof engineSignInCodeSchema>;

/**
 * PUT /settings/engines/:engineId/token: "Paste a token instead", a token made with
 * `claude setup-token`, which signs the engine in and is never sent back. DELETE
 * /settings/engines/:engineId/sign-in signs the engine out, whatever signed it in.
 */
export const enginePastedTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(
      /^sk-ant-oat01-[\w-]+$/,
      "That is no token from `claude setup-token`: one starts with sk-ant-oat01-.",
    ),
});
export type EnginePastedToken = z.infer<typeof enginePastedTokenSchema>;

/**
 * A Claude Code engine's account changed (a Sign in ended, a token was pasted, or it was signed
 * out), so an open Settings page refetches it.
 */
export const engineWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("engine.account-changed"), engineId: engineIdSchema }),
]);
export type EngineWebEvent = z.infer<typeof engineWebEventSchema>;

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
