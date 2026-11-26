import { z } from "zod";
import { webEventSchema } from "./events.js";
import { initiativeStateSchema, taskStateSchema } from "./work-states.js";

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
  "carrySession",
  "startsUsageWindow",
]);
export type EngineCapability = z.infer<typeof engineCapabilitySchema>;

/**
 * A model an API endpoint serves, by its id there, with how many tokens its context holds and
 * whether it sees images, which the user tells (Sees images, off until set).
 */
export const apiEndpointModelSchema = z.object({
  id: z.string(),
  contextWindow: z.int().positive(),
  seesImages: z.boolean().default(false),
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

/** How hard the model thinks. */
export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

/**
 * An engine's Default effort: one its type takes (`ENGINE_TYPE_EFFORTS`), or null, Not set, which
 * leaves it to the engine type. A type that takes none keeps it null.
 */
const defaultEffortSchema = effortSchema.nullable();

/** A Claude Code account, which may run on the `-p` fallback instead of the Agent SDK. */
export const claudeCodeEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("claude-code"),
  /** One of the Claude models, which picking the engine fills in. */
  defaultModel: z.string(),
  defaultEffort: defaultEffortSchema,
  claudeCodeP: z.boolean(),
});
export type ClaudeCodeEngine = z.infer<typeof claudeCodeEngineSchema>;

/**
 * The models a Claude Code engine offers until its account first lists its own, by their ids;
 * mirrors the Engine module's `CLAUDE_CODE_MODELS`, so an engine not saved yet offers them.
 */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

/** An API endpoint of the OpenAI-compatible API. */
export const apiEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("openai-compatible-api"),
  /** One of its models, by its id there. */
  defaultModel: z.string(),
  defaultEffort: defaultEffortSchema,
  baseUrl: z.string(),
  /** The key itself is never sent back. */
  keySet: z.boolean(),
  models: z.array(apiEndpointModelSchema),
});
export type ApiEngine = z.infer<typeof apiEngineSchema>;

/**
 * An OpenAI account whose sessions run on the pinned `codex app-server`. Its API key, when one
 * signs it in, has no field here: it is never sent back.
 */
export const codexEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("codex"),
  /** One of the Codex models, which picking the engine fills in. */
  defaultModel: z.string(),
  defaultEffort: defaultEffortSchema,
});
export type CodexEngine = z.infer<typeof codexEngineSchema>;

/**
 * The models a Codex engine offers until its account first lists its own, by their ids; mirrors
 * the Engine module's `CODEX_MODELS` (its domain doesn't read the contracts), so an engine not
 * saved yet offers them and the web tells a Codex model from a Claude one.
 */
export const CODEX_MODELS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

/**
 * A GitHub account with Copilot whose sessions run on the Copilot CLI runtime. Its pasted token,
 * when one signs it in, has no field here: it is never sent back.
 */
export const copilotCliEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("copilot-cli"),
  /** One of the Copilot CLI models; Auto unless the user picks another. */
  defaultModel: z.string(),
  defaultEffort: defaultEffortSchema,
});
export type CopilotCliEngine = z.infer<typeof copilotCliEngineSchema>;

/**
 * Auto, the Copilot CLI model that names none and lets the runtime choose, and the models a
 * Copilot CLI engine offers; mirrors the Engine module's `COPILOT_CLI_MODELS`.
 */
export const COPILOT_CLI_AUTO_MODEL = "auto";
export const COPILOT_CLI_MODELS = [COPILOT_CLI_AUTO_MODEL] as const;

/**
 * A Gemini API key from Google AI Studio whose sessions run on the pinned Gemini CLI. The key has
 * no field here: it is never sent back; its account tells whether one is set.
 */
export const geminiCliEngineSchema = z.object({
  id: engineIdSchema,
  name: z.string(),
  kind: z.literal("gemini-cli"),
  /** One of the Gemini CLI models; Auto unless the user picks another. */
  defaultModel: z.string(),
  defaultEffort: defaultEffortSchema,
});
export type GeminiCliEngine = z.infer<typeof geminiCliEngineSchema>;

/**
 * The models a Gemini CLI engine offers: the pinned CLI's aliases, each the newest Gemini model of
 * its line the key may use, Auto first; mirrors the Engine module's `GEMINI_CLI_MODELS`.
 */
export const GEMINI_CLI_MODELS = ["auto", "pro", "flash", "flash-lite"] as const;

/** An engine the user lists in Settings › Engines (spec §5.4). */
export const engineSchema = z.discriminatedUnion("kind", [
  claudeCodeEngineSchema,
  apiEngineSchema,
  codexEngineSchema,
  copilotCliEngineSchema,
  geminiCliEngineSchema,
]);
export type Engine = z.infer<typeof engineSchema>;
export type EngineKind = Engine["kind"];

/**
 * The efforts each engine type takes, in order; a type that takes none shows no Effort anywhere.
 * Mirrors the Engine module's list (its domain doesn't read the contracts).
 */
export const ENGINE_TYPE_EFFORTS: Readonly<Record<EngineKind, readonly Effort[]>> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  "copilot-cli": [],
  "gemini-cli": [],
  "openai-compatible-api": [],
};

/** An engine and one of its models, by its id there. */
export const engineModelSchema = z.object({ engineId: engineIdSchema, model: z.string() });
export type EngineModel = z.infer<typeof engineModelSchema>;

/** An engine type, by its key: the `kind` of each of its engines. */
export const engineTypeSchema = z.enum([
  "claude-code",
  "openai-compatible-api",
  "codex",
  "copilot-cli",
  "gemini-cli",
]);

/**
 * The Office default: an engine type and one of its accounts, an engine of that type, whose own
 * default model it runs on.
 */
export const officeDefaultSchema = z.object({
  engineType: engineTypeSchema,
  engineId: engineIdSchema,
});
export type OfficeDefault = z.infer<typeof officeDefaultSchema>;

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
 * A Claude or Codex model's `engineId` is null: its price is shared by every Claude Code engine, or
 * every Codex engine. An API, Copilot CLI or Gemini CLI engine's model is priced on that engine.
 */
export const offeredModelSchema = z.object({
  engineId: engineIdSchema.nullable(),
  model: z.string(),
  price: modelPriceSchema.nullable(),
});
export type OfferedModel = z.infer<typeof offeredModelSchema>;

/** A Window start's set time of day, `HH:MM` on the service's clock (spec §5.4.6). */
export const windowStartTimeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

/** At most one Window start a set time a day for each hour, more than any account needs. */
export const MAX_WINDOW_START_TIMES = 24;

/**
 * When an engine with usage windows starts its 5-hour window by itself (spec §5.4.6, "Starting the
 * 5-hour window"): at each set time, and right after each reset when `startAfterReset` is on.
 */
export const windowStartSettingsSchema = z.object({
  /** Unique and sorted; a malformed or duplicate time is refused (422), not by the contract. */
  startAtTimes: z.array(z.string()).max(MAX_WINDOW_START_TIMES),
  startAfterReset: z.boolean(),
});
export type WindowStartSettings = z.infer<typeof windowStartSettingsSchema>;

/** Why a Window start was skipped, the first rule that applies (spec §5.4.6). */
export const windowStartSkipReasonSchema = z.enum([
  "readings-unknown",
  "engine-used-up",
  "no-5-hour-window",
  "window-running",
  "weekly-used-up",
  "weekly-nearly-used-up",
]);
export type WindowStartSkipReason = z.infer<typeof windowStartSkipReasonSchema>;

/** What set a Window start off: one of the set times, or a 5-hour window's reset. */
export const windowStartTriggerSchema = z.enum(["set-time", "after-reset"]);
export type WindowStartTrigger = z.infer<typeof windowStartTriggerSchema>;

/** The last Window start of an engine: started, skipped with its reason, or failed with its error. */
export const windowStartRecordSchema = z.object({
  at: z.iso.datetime(),
  outcome: z.enum(["started", "skipped", "failed"]),
  /** Only when skipped. */
  reason: windowStartSkipReasonSchema.nullable(),
  /** Only when failed. */
  error: z.string().nullable(),
  trigger: windowStartTriggerSchema,
  /** When started, the 5-hour window's reset the read after it showed; null when it didn't tell. */
  fiveHourResetsAt: z.iso.datetime().nullable(),
});
export type WindowStartRecord = z.infer<typeof windowStartRecordSchema>;

/** One engine's Window start, as Settings › Engines shows it on an engine with usage windows. */
export const engineWindowStartSchema = windowStartSettingsSchema.extend({
  engineId: engineIdSchema,
  /** Null when neither setting starts one. */
  nextStartAt: z.iso.datetime().nullable(),
  /** Null until the first start or skip. */
  last: windowStartRecordSchema.nullable(),
});
export type EngineWindowStart = z.infer<typeof engineWindowStartSchema>;

/** A Window start's settings as Settings › Engines saves them. */
export const engineWindowStartEditSchema = windowStartSettingsSchema.extend({
  engineId: engineIdSchema,
});
export type EngineWindowStartEdit = z.infer<typeof engineWindowStartEditSchema>;

/**
 * The models an engine offers now, as Settings › Engines and the Role card pick among them (spec
 * §5.4.5, "Models an engine lists"): those its account listed when last asked, else its type's
 * fixed list (`CODEX_MODELS` and the like); an API endpoint's are its own `models`.
 *
 * POST /settings/engines/:engineId/models/refresh asks the engine's account for them now and keeps
 * them, announced as `engine.models-listed`: 204 once it answered, the list kept as it was when it
 * listed none; 404 for an engine not listed; 422, in words, for one whose type isn't asked
 * (`listsItsModels` false); 502, in words naming the engine, when asking failed or timed out, the
 * list kept as it was.
 */
export const engineModelListSchema = z.object({
  engineId: engineIdSchema,
  /** By their ids, in the order offered. */
  models: z.array(z.string()),
  /** Whether the engine's account is asked for its models, so Refresh models applies. */
  listsItsModels: z.boolean(),
  /** When its account last listed them; null while its type's fixed list stands in. */
  listedAt: z.iso.datetime().nullable(),
});
export type EngineModelList = z.infer<typeof engineModelListSchema>;

/** GET and PUT /settings/engines: the Office-wide settings of the engines. */
export const engineSettingsSchema = z.object({
  /** In the order Settings › Engines lists them. */
  engines: z.array(engineSchema),
  /**
   * The engine type and account every Role runs on unless something more specific applies; null
   * only while no engine is listed, the only one removed.
   */
  officeDefault: officeDefaultSchema.nullable(),
  /** Null until the user sets one; WebSearch is refused meanwhile. */
  searchEndpoint: searchEndpointSchema.nullable(),
  /**
   * Every model offered now: the Claude models first, then the Codex models, then each API,
   * Copilot CLI and Gemini CLI engine's.
   */
  modelPrices: z.array(offeredModelSchema),
  /**
   * The Stand-in Engines, in the order one is picked to take over for an engine whose usage window
   * is used up; a switch keeps the model, so only one serving it takes over.
   */
  standInEngines: z.array(engineIdSchema),
  /** The context size, in tokens, above which a switch of a running Stage asks first; 0 always asks. */
  askBeforeSwitchAbove: z.number(),
  /**
   * Each engine with usage windows' Window start, in the order of `engines`; a top-level list, as
   * the engine edit schemas extend the engines' read schemas.
   */
  windowStarts: z.array(engineWindowStartSchema),
  /**
   * Each engine's models but an API endpoint's, in the order of `engines`; a top-level list, as
   * the engine edit schemas extend the engines' read schemas.
   */
  modelLists: z.array(engineModelListSchema),
  /** The service's IANA time zone, which the set times of a Window start follow. */
  timeZone: z.string(),
});
export type EngineSettings = z.infer<typeof engineSettingsSchema>;

/** A Claude Code engine as Settings › Engines saves it: without an `id` when it is new. */
export const claudeCodeEngineEditSchema = claudeCodeEngineSchema.extend({
  id: engineIdSchema.optional(),
  /** Left out, the stored effort is kept; a new engine gets Not set. */
  defaultEffort: defaultEffortSchema.optional(),
});
export type ClaudeCodeEngineEdit = z.infer<typeof claudeCodeEngineEditSchema>;

/**
 * An API engine as Settings › Engines saves it: without an `id` when it is new. Without a `key` it
 * keeps the one kept; an empty key means none, as on a local server. A context window that isn't
 * a positive whole number is refused with words (422), not by the contract.
 */
export const apiEngineEditSchema = apiEngineSchema.omit({ keySet: true, models: true }).extend({
  id: engineIdSchema.optional(),
  /** Left out, the stored effort is kept; a new engine gets Not set. */
  defaultEffort: defaultEffortSchema.optional(),
  key: z.string().optional(),
  models: z.array(apiEndpointModelSchema.extend({ contextWindow: z.number() })),
});
export type ApiEngineEdit = z.infer<typeof apiEngineEditSchema>;

/**
 * A Codex engine as Settings › Engines saves it: without an `id` when it is new. A Save never
 * carries its API key and keeps the one kept: PUT /settings/engines/:engineId/api-key sets it.
 */
export const codexEngineEditSchema = codexEngineSchema.extend({
  id: engineIdSchema.optional(),
  /** Left out, the stored effort is kept; a new engine gets Not set. */
  defaultEffort: defaultEffortSchema.optional(),
});
export type CodexEngineEdit = z.infer<typeof codexEngineEditSchema>;

/**
 * A Copilot CLI engine as Settings › Engines saves it: without an `id` when it is new. A Save never
 * carries its token and keeps the one kept: PUT /settings/engines/:engineId/token sets it.
 */
export const copilotCliEngineEditSchema = copilotCliEngineSchema.extend({
  id: engineIdSchema.optional(),
  /** Left out, the stored effort is kept; a new engine gets Not set. */
  defaultEffort: defaultEffortSchema.optional(),
});
export type CopilotCliEngineEdit = z.infer<typeof copilotCliEngineEditSchema>;

/**
 * A Gemini CLI engine as Settings › Engines saves it: without an `id` when it is new. A Save never
 * carries its API key and keeps the one kept: PUT /settings/engines/:engineId/api-key sets it.
 */
export const geminiCliEngineEditSchema = geminiCliEngineSchema.extend({
  id: engineIdSchema.optional(),
  /** Left out, the stored effort is kept; a new engine gets Not set. */
  defaultEffort: defaultEffortSchema.optional(),
});
export type GeminiCliEngineEdit = z.infer<typeof geminiCliEngineEditSchema>;

export const engineEditSchema = z.discriminatedUnion("kind", [
  claudeCodeEngineEditSchema,
  apiEngineEditSchema,
  codexEngineEditSchema,
  copilotCliEngineEditSchema,
  geminiCliEngineEditSchema,
]);
export type EngineEdit = z.infer<typeof engineEditSchema>;

/**
 * PUT /settings/engines: every engine, in order, the Office default, the search endpoint, the
 * Model prices, the Stand-in Engines and the ask-above size. A saved engine left out is refused
 * (422): DELETE /settings/engines/:engineId removes one. A price of a model the saved engines no
 * longer offer is dropped.
 */
export const engineSettingsEditSchema = z.object({
  engines: z.array(engineEditSchema),
  /**
   * Null only with no engine listed; with any listed, one is picked, its type the engine's (422
   * otherwise).
   */
  officeDefault: officeDefaultSchema.nullable(),
  searchEndpoint: searchEndpointSchema.nullable(),
  modelPrices: z.array(offeredModelSchema),
  /**
   * Left out, the stored list is kept. An engine not listed or named twice is refused (422).
   */
  standInEngines: z.array(engineIdSchema).optional(),
  /** Left out, the stored size is kept. One that isn't a whole number 0–10,000,000 is refused (422). */
  askBeforeSwitchAbove: z.number().optional(),
  /**
   * Left out, the stored Window starts are kept; an engine left out of the list keeps its own. A
   * malformed or duplicate time, or a Window start on an engine without usage windows, is refused
   * (422).
   */
  windowStarts: z.array(engineWindowStartEditSchema).optional(),
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
 * A level naming the engine being removed, where it stands and where the removal puts it: from the
 * removed engine to the replacement, or to none when the only engine goes. What it belongs to tells
 * the level: a Project for its Project default, none for the Office default; a Task or an
 * Initiative for its engine override, with its Project, Done and Dropped ones too, and its state,
 * which marks those; `standInList` for a Stand-in Engine list, the Office's with no Project, a
 * Project's own (used or not) with it. Every level names an engine, not a model, so people's
 * settings, which name engine types, never move.
 */
export const movedEngineReferenceSchema = z.object({
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** The Task or Initiative whose engine override it is, with its state; null otherwise. */
  work: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("task"),
        id: z.string(),
        name: z.string(),
        state: taskStateSchema,
      }),
      z.object({
        kind: z.literal("initiative"),
        id: z.string(),
        name: z.string(),
        state: initiativeStateSchema,
      }),
    ])
    .nullable(),
  /**
   * Set on a Stand-in Engine list's move, to none when the engine is just dropped, as the list
   * already names the replacement; left out for every other level.
   */
  standInList: z.literal(true).optional(),
  from: engineIdSchema,
  to: engineIdSchema.nullable(),
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
 * gives it, a Codex engine's as `account/read` gives it, a Copilot CLI engine's as the runtime's
 * sign-in status gives it, or a Gemini CLI engine's as its kept API key tells it; the email and plan
 * null when signed out, signed in by a pasted token or an API key, or not told.
 */
export const engineAccountSchema = z.object({
  signedIn: z.boolean(),
  /**
   * A token pasted with "Paste a token instead" signs a Claude Code or Copilot CLI engine in, not a
   * Sign in.
   */
  pastedToken: z.boolean(),
  /**
   * An API key signs the engine in, not a Sign in: an Anthropic one given a Claude Code engine with
   * "Use an API key", an OpenAI one given a Codex engine with "Use an API key instead", or a Gemini
   * one, the only sign-in of a Gemini CLI engine. Such an engine has no usage windows.
   */
  apiKey: z.boolean(),
  /** The account's email; on a Copilot CLI engine, its GitHub login, which it has in place of one. */
  email: z.string().nullable(),
  /** The Claude subscription, such as `max` or `pro`. */
  plan: z.string().nullable(),
});
export type EngineAccount = z.infer<typeof engineAccountSchema>;

/**
 * POST /settings/engines/:engineId/sign-in: the Sign in started. On a Claude Code engine the
 * browser opens by itself where there is a display; the page signs in from any browser and gives a
 * code to paste back. On a Codex or Copilot CLI engine it is a device-code login: the page signs in
 * from any browser once `userCode` is entered there, with nothing pasted back, and the login's end
 * is announced as `engine.account-changed`.
 */
export const engineSignInSchema = z.object({ url: z.url(), userCode: z.string().optional() });
export type EngineSignIn = z.infer<typeof engineSignInSchema>;

/** POST /settings/engines/:engineId/sign-in/code: the code the sign-in page gave. */
export const engineSignInCodeSchema = z.object({ code: z.string().trim().min(1) });
export type EngineSignInCode = z.infer<typeof engineSignInCodeSchema>;

/**
 * PUT /settings/engines/:engineId/token: "Paste a token instead", which signs the engine in and is
 * never sent back. On a Claude Code engine a token made with `claude setup-token`; on a Copilot CLI
 * engine `copilotCliPastedTokenSchema`'s. DELETE /settings/engines/:engineId/sign-in signs the
 * engine out, whatever signed it in.
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
 * PUT /settings/engines/:engineId/token's body as the service takes it: the token's shape is the
 * engine's kind's (`enginePastedTokenSchema` or `copilotCliPastedTokenSchema`), refused with the
 * same words (400) when it isn't one.
 */
export const engineTokenSchema = z.object({ token: z.string().trim().min(1) });
export type EngineToken = z.infer<typeof engineTokenSchema>;

/**
 * PUT /settings/engines/:engineId/token on a Copilot CLI engine: a fine-grained personal access
 * token with the "Copilot Requests" permission, kept in the database and never sent back.
 */
export const copilotCliPastedTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(
      /^github_pat_\w+$/,
      'That is no fine-grained personal access token: one starts with github_pat_ and has the "Copilot Requests" permission.',
    ),
});
export type CopilotCliPastedToken = z.infer<typeof copilotCliPastedTokenSchema>;

/**
 * PUT /settings/engines/:engineId/api-key: an API key, which replaces any other sign-in and is never
 * sent back. On a Claude Code engine "Use an API key", an Anthropic API key, kept in the engine's
 * folder and refused unless it starts with sk-ant- (not sk-ant-oat); on a Codex engine "Use an API key instead",
 * an OpenAI API key, kept in the database; on a Gemini CLI engine, which has no Sign in, the Gemini
 * API key from Google AI Studio that signs it in, kept in the database.
 */
export const engineApiKeySchema = z.object({ key: z.string().trim().min(1) });
export type EngineApiKey = z.infer<typeof engineApiKeySchema>;

/**
 * A Claude Code, Codex or Copilot CLI engine's account changed (a Sign in ended, a token or an API
 * key was given, or it was signed out), so an open Settings page refetches it; or an engine's
 * Window start changed (its settings, a start, skip or failure, or its next start moved); or an
 * engine's account listed its models, so the model choices are read again.
 */
export const engineWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("engine.account-changed"), engineId: engineIdSchema }),
  webEventSchema.extend({ type: z.literal("engine.models-listed"), engineId: engineIdSchema }),
  webEventSchema.extend({
    type: z.literal("engine.window-start-changed"),
    engineId: engineIdSchema,
  }),
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

const KNOWN_USAGE_WINDOW_WORDS: Readonly<Record<string, string>> = {
  "five-hour": "5-hour window",
  "seven-day": "7-day window",
  "seven-day-opus": "Opus weekly window",
  "seven-day-sonnet": "Sonnet weekly window",
  "seven-day-overage-included": "weekly window",
  overage: "extra usage",
  unknown: "usage window",
};

/**
 * A usage window as the user reads it, such as "5-hour window", from the Engine port's name for it;
 * mirrors the Engine module's `usageWindowWords` (its domain doesn't read the contracts), so the
 * web words a window as the service's queue reasons and Notifications do. A window the engine
 * names but the port doesn't is worded by its own name.
 */
export function usageWindowWords(window: string): string {
  return Object.hasOwn(KNOWN_USAGE_WINDOW_WORDS, window)
    ? (KNOWN_USAGE_WINDOW_WORDS[window] as string)
    : `${window} window`;
}
