import { movedEngineModel, type EngineRemoval } from "./engine-removal.js";
import { EngineSettingsRefused, ENGINES_CHANGED_MEANWHILE } from "./engine-settings-refused.js";
import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  engineIdFor,
  FIRST_CLAUDE_CODE_ENGINE,
  offeredModels,
  pricedPerEngine,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
  type CopilotCliEngine,
  type Engine,
  type EngineId,
  type EngineModel,
  type GeminiCliEngine,
} from "./engines.js";
import {
  keptModelPrices,
  pricedModels,
  type OfferedModel,
  type PricedModel,
} from "./model-prices.js";

/** The web search WebSearch goes through for the OpenAI-compatible API: SearXNG's JSON API. */
export interface SearchEndpoint {
  readonly baseUrl: string;
}

/** The engines' Office-wide settings, which Settings › Engines holds (spec §5.4). */
export interface EngineSettings {
  /** In the order Settings › Engines lists them. */
  readonly engines: readonly Engine[];
  /**
   * The engine and model every Role runs on unless something more specific applies; none only
   * while no engine is listed, so nothing runs.
   */
  readonly officeDefault: EngineModel | null;
  /** Null until the user sets one. */
  readonly searchEndpoint: SearchEndpoint | null;
  /** Only the models offered now that have a Model price. */
  readonly modelPrices: readonly PricedModel[];
  /** The Stand-in Engines, each listed once, in the order `engineToRunOn` tries them. */
  readonly standInEngines: readonly EngineId[];
  /** The context size, in tokens, above which a switch of a running Stage asks first; 0 always asks. */
  readonly askBeforeSwitchAbove: number;
}

/**
 * A switch loses the prompt cache, so the whole context is written again: above this many tokens
 * that costs enough to ask first.
 */
export const DEFAULT_ASK_BEFORE_SWITCH_ABOVE = 100_000;

/** Above any model's context window, and within the `integer` column it is kept in. */
export const ASK_BEFORE_SWITCH_ABOVE_MOST = 10_000_000;

/** The first Claude Code engine on its default model, as the upgrade leaves it. */
export const FIRST_OFFICE_DEFAULT: EngineModel = {
  engineId: FIRST_CLAUDE_CODE_ENGINE.id,
  model: FIRST_CLAUDE_CODE_ENGINE.defaultModel,
};

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  engines: [FIRST_CLAUDE_CODE_ENGINE],
  officeDefault: FIRST_OFFICE_DEFAULT,
  searchEndpoint: null,
  modelPrices: [],
  standInEngines: [],
  askBeforeSwitchAbove: DEFAULT_ASK_BEFORE_SWITCH_ABOVE,
};

/** A Claude Code engine as Settings › Engines saves it: without an `id` when it is new. */
export type ClaudeCodeEngineEdit = Omit<ClaudeCodeEngine, "id"> & { readonly id?: EngineId };

/**
 * An API engine as Settings › Engines saves it: without an `id` when it is new, and without a `key`
 * when it keeps the one kept.
 */
export type ApiEngineEdit = Omit<ApiEngine, "id" | "key"> & {
  readonly id?: EngineId;
  readonly key?: string;
};

/**
 * A Codex engine as Settings › Engines saves it: without an `id` when it is new, and never with
 * its API key, which only signing it in sets (a Save keeps the one kept).
 */
export type CodexEngineEdit = Omit<CodexEngine, "id" | "apiKey"> & { readonly id?: EngineId };

/**
 * A Copilot CLI engine as Settings › Engines saves it: without an `id` when it is new, and never
 * with its token, which only "Paste a token instead" sets (a Save keeps the one kept).
 */
export type CopilotCliEngineEdit = Omit<CopilotCliEngine, "id" | "token"> & {
  readonly id?: EngineId;
};

/**
 * A Gemini CLI engine as Settings › Engines saves it: without an `id` when it is new, and never
 * with its API key, which only its own route sets (a Save keeps the one kept).
 */
export type GeminiCliEngineEdit = Omit<GeminiCliEngine, "id" | "apiKey"> & {
  readonly id?: EngineId;
};

export type EngineEdit =
  | ClaudeCodeEngineEdit
  | ApiEngineEdit
  | CodexEngineEdit
  | CopilotCliEngineEdit
  | GeminiCliEngineEdit;

export interface EngineSettingsEdit {
  /** Every engine, in order; a saved one left out is refused, as removing one moves what names it. */
  readonly engines: readonly EngineEdit[];
  /** None only with no engine listed. */
  readonly officeDefault: EngineModel | null;
  readonly searchEndpoint: SearchEndpoint | null;
  readonly modelPrices: readonly OfferedModel[];
  /** Left out, the stored list is kept. */
  readonly standInEngines?: readonly EngineId[];
  /** Left out, the stored size is kept. */
  readonly askBeforeSwitchAbove?: number;
}

export const ENGINE_NAME_LENGTH = 40;

/**
 * Every model that may be priced, in order, with its Model price or none: the Claude models while
 * there is a Claude Code engine, the Codex models while there is a Codex engine, then each API and
 * Copilot CLI and Gemini CLI engine's, in their order.
 */
export function offeredModelPrices({ engines, modelPrices }: EngineSettings): OfferedModel[] {
  const priceOf = (engineId: EngineId | null, model: string) =>
    modelPrices.find((each) => each.engineId === engineId && each.model === model)?.price ?? null;
  const pricedOnTheirOwn = engines.filter(pricedPerEngine).map(({ id }) => id);
  return [null, ...pricedOnTheirOwn].flatMap((engineId) =>
    modelsPricedUnder(engines, engineId).map((model) => ({
      engineId,
      model,
      price: priceOf(engineId, model),
    })),
  );
}

/**
 * The models priced under a price's `engineId`: null for the Claude models while a Claude Code
 * engine is listed, then the Codex models while a Codex engine is, each priced once for them all;
 * an API, Copilot CLI or Gemini CLI engine's id for its own models.
 */
function modelsPricedUnder(
  engines: readonly Engine[],
  engineId: EngineId | null,
): readonly string[] {
  if (engineId === null) {
    return [
      ...(engines.some(({ kind }) => kind === "claude-code") ? CLAUDE_CODE_MODELS : []),
      ...(engines.some(({ kind }) => kind === "codex") ? CODEX_MODELS : []),
    ];
  }
  const engine = engines.find(({ id }) => id === engineId);
  return engine !== undefined && pricedPerEngine(engine) ? offeredModels(engine) : [];
}

/**
 * The settings `edit` makes of `stored`: the engines in its order, a new one given its id from its
 * name, an API engine keeping its key unless the edit gives one, a Codex engine always keeping its
 * API key, a Copilot CLI engine its token and a Gemini CLI engine its API key; the Office default;
 * and the Model prices of the models offered, a removed engine's kept (`keptModelPrices`); the Stand-in Engines and the
 * ask-above size, the stored ones when left out. Refuses with every reason when they break a rule.
 */
export function changedEngineSettings(
  stored: EngineSettings,
  edit: EngineSettingsEdit,
): EngineSettings {
  return settingsOf(stored, edit, leftOutEngineProblems(stored.engines, edit.engines));
}

/**
 * The settings once the removal is done: the engine gone and the Office default moved by
 * `movedEngineModel`, to none with the only engine, the engine dropped from the Stand-in Engines,
 * the rest kept. Refuses with every reason when they break a rule.
 */
export function settingsWithoutEngine(
  stored: EngineSettings,
  removal: EngineRemoval,
): EngineSettings {
  const edit: EngineSettingsEdit = {
    engines: stored.engines.filter(({ id }) => id !== removal.engineId),
    officeDefault: stored.officeDefault && movedEngineModel(stored.officeDefault, removal),
    searchEndpoint: stored.searchEndpoint,
    modelPrices: stored.modelPrices,
    standInEngines: stored.standInEngines.filter((engineId) => engineId !== removal.engineId),
    askBeforeSwitchAbove: stored.askBeforeSwitchAbove,
  };
  return settingsOf(stored, edit, []);
}

function settingsOf(
  stored: EngineSettings,
  edit: EngineSettingsEdit,
  problems: string[],
): EngineSettings {
  const engines = changedEnginesOf(stored.engines, edit.engines, problems);
  for (const engine of engines) problems.push(...engineProblems(engine));
  problems.push(...duplicateNameProblems(engines));
  const officeDefault = officeDefaultOf(edit.officeDefault, engines, stored.engines);
  problems.push(...officeDefaultProblems(officeDefault, engines));
  const searchEndpoint = edit.searchEndpoint && { baseUrl: edit.searchEndpoint.baseUrl.trim() };
  if (searchEndpoint && !isWebAddress(searchEndpoint.baseUrl)) {
    problems.push("Give the search endpoint a base URL starting with http:// or https://.");
  }
  const offeredNow = (engineId: EngineId | null) => modelsPricedUnder(engines, engineId);
  const edited = pricedModels(edit.modelPrices, offeredNow, problems);
  const kept = keptModelPrices(
    stored.modelPrices,
    edited,
    (engineId) => modelsPricedUnder(stored.engines, engineId),
    offeredNow,
  );
  const standInEngines = edit.standInEngines ?? stored.standInEngines;
  problems.push(...standInEngineProblems(standInEngines, engines));
  const askBeforeSwitchAbove = edit.askBeforeSwitchAbove ?? stored.askBeforeSwitchAbove;
  if (
    !Number.isInteger(askBeforeSwitchAbove) ||
    askBeforeSwitchAbove < 0 ||
    askBeforeSwitchAbove > ASK_BEFORE_SWITCH_ABOVE_MOST
  ) {
    problems.push(
      `Give the context size to ask above as a whole number of tokens from 0 to ${ASK_BEFORE_SWITCH_ABOVE_MOST.toLocaleString("en-US")} (0 always asks).`,
    );
  }
  if (problems.length > 0) throw new EngineSettingsRefused([...new Set(problems)]);
  return {
    engines,
    officeDefault,
    searchEndpoint,
    modelPrices: [...edited, ...kept],
    standInEngines: [...standInEngines],
    askBeforeSwitchAbove,
  };
}

function standInEngineProblems(
  standInEngines: readonly EngineId[],
  engines: readonly Engine[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<EngineId>();
  for (const engineId of standInEngines) {
    const engine = engines.find(({ id }) => id === engineId);
    if (engine === undefined) {
      problems.push("Pick each Stand-in Engine among the engines listed.");
    } else if (seen.has(engineId)) {
      problems.push(`"${engine.name}" is listed twice as a Stand-in Engine.`);
    }
    seen.add(engineId);
  }
  return problems;
}

function changedEnginesOf(
  stored: readonly Engine[],
  edits: readonly EngineEdit[],
  problems: string[],
): Engine[] {
  const storedById = new Map(stored.map((engine) => [engine.id, engine]));
  // A new engine never takes a listed engine's id, nor one the edit names.
  const taken = new Set([
    ...storedById.keys(),
    ...edits.flatMap(({ id }) => (id === undefined ? [] : [id])),
  ]);
  const seen = new Set<string>();
  return edits.map((edit) => {
    const name = edit.name.trim();
    const kept = edit.id === undefined ? undefined : storedById.get(edit.id);
    if (edit.id !== undefined && (kept?.kind !== edit.kind || seen.has(edit.id))) {
      problems.push(ENGINES_CHANGED_MEANWHILE);
    }
    const id = edit.id ?? engineIdFor(name, taken);
    taken.add(id);
    seen.add(id);
    const common = { id, name, defaultModel: edit.defaultModel.trim() };
    if (edit.kind === "claude-code") {
      return { ...common, kind: edit.kind, claudeCodeP: edit.claudeCodeP };
    }
    if (edit.kind === "codex") {
      return { ...common, kind: edit.kind, apiKey: kept?.kind === "codex" ? kept.apiKey : null };
    }
    if (edit.kind === "copilot-cli") {
      return {
        ...common,
        kind: edit.kind,
        token: kept?.kind === "copilot-cli" ? kept.token : null,
      };
    }
    if (edit.kind === "gemini-cli") {
      return {
        ...common,
        kind: edit.kind,
        apiKey: kept?.kind === "gemini-cli" ? kept.apiKey : null,
      };
    }
    const keptKey = kept?.kind === "openai-compatible-api" ? kept.key : "";
    return {
      ...common,
      kind: edit.kind,
      baseUrl: edit.baseUrl.trim(),
      key: edit.key?.trim() ?? keptKey,
      models: edit.models.map((model) => ({ ...model, id: model.id.trim() })),
    };
  });
}

function engineProblems(engine: Engine): string[] {
  const { id, name } = engine;
  const problems: string[] = [];
  if (name === "") problems.push("Give each engine a name.");
  else if (id === "") problems.push(`Give "${name}" a name with letters or digits.`);
  if (name.length > ENGINE_NAME_LENGTH) {
    problems.push(`An engine's name may be at most ${ENGINE_NAME_LENGTH} characters.`);
  }
  const called = name === "" ? "the engine" : `"${name}"`;
  if (engine.kind === "openai-compatible-api") problems.push(...apiEngineProblems(engine, called));
  if (!offeredModels(engine).includes(engine.defaultModel)) {
    problems.push(`Pick the default model of ${called} among its models.`);
  }
  return problems;
}

function apiEngineProblems({ baseUrl, models }: ApiEngine, called: string): string[] {
  const problems: string[] = [];
  if (!isWebAddress(baseUrl)) {
    problems.push(`Give ${called} a base URL starting with http:// or https://.`);
  }
  if (models.length === 0) problems.push(`Give ${called} at least one model.`);
  const ids = new Set<string>();
  for (const model of models) {
    if (model.id === "") problems.push(`Give each model of ${called} its id.`);
    else if (ids.has(model.id)) {
      problems.push(`${capitalised(called)} lists the model "${model.id}" twice.`);
    }
    ids.add(model.id);
    if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0) {
      problems.push(`Give each model of ${called} its context window, in tokens.`);
    }
  }
  return problems;
}

function duplicateNameProblems(engines: readonly Engine[]): string[] {
  const names = new Set<string>();
  const problems: string[] = [];
  for (const { name } of engines) {
    const folded = name.toLowerCase();
    if (name !== "" && names.has(folded)) problems.push(`Two engines are called "${name}".`);
    names.add(folded);
  }
  return problems;
}

/** A saved engine is removed on its own, which moves what names it (`settingsWithoutEngine`). */
function leftOutEngineProblems(stored: readonly Engine[], edits: readonly EngineEdit[]): string[] {
  const editedIds = new Set(edits.map(({ id }) => id));
  return stored
    .filter(({ id }) => !editedIds.has(id))
    .map(({ name }) => `Remove "${name}" on its own, so what names it moves to another engine.`);
}

/**
 * The Office default the edit names; with none named while no engine was listed, the first engine
 * saved takes it on its default model, so sessions start again once an engine is added (spec §5.4).
 */
function officeDefaultOf(
  edited: EngineModel | null,
  engines: readonly Engine[],
  stored: readonly Engine[],
): EngineModel | null {
  if (edited) return { engineId: edited.engineId, model: edited.model };
  const [first] = engines;
  return first && stored.length === 0 ? { engineId: first.id, model: first.defaultModel } : null;
}

function officeDefaultProblems(
  officeDefault: EngineModel | null,
  engines: readonly Engine[],
): string[] {
  if (officeDefault === null) {
    return engines.length === 0 ? [] : ["Pick the Office default among the engines listed."];
  }
  const { engineId, model } = officeDefault;
  const engine = engines.find(({ id }) => id === engineId);
  if (engine === undefined) return ["Pick the Office default among the engines listed."];
  if (!offeredModels(engine).includes(model)) {
    return [`Pick the Office default's model among the models of "${engine.name}".`];
  }
  return [];
}

function isWebAddress(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === "http:" || protocol === "https:";
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
