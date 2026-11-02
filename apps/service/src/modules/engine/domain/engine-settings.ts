import { apiEndpointIdFor, type ApiEndpointModel } from "./api-endpoints.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import {
  CLAUDE_CODE_MODELS,
  FIRST_CLAUDE_CODE_ENGINE,
  offeredModels,
  type ApiEngine,
  type Engine,
  type EngineId,
} from "./engines.js";
import { pricedModels, type OfferedModel, type PricedModel } from "./model-prices.js";

/** The web search WebSearch goes through for the OpenAI-compatible API: SearXNG's JSON API. */
export interface SearchEndpoint {
  readonly baseUrl: string;
}

/** The engines' Office-wide settings, which Settings › Engines holds (spec §5.4). */
export interface EngineSettings {
  /** In the order Settings › Engines lists them. */
  readonly engines: readonly Engine[];
  /** Null until the user sets one. */
  readonly searchEndpoint: SearchEndpoint | null;
  /** Only the models offered now that have a Model price. */
  readonly modelPrices: readonly PricedModel[];
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  engines: [FIRST_CLAUDE_CODE_ENGINE],
  searchEndpoint: null,
  modelPrices: [],
};

/**
 * An API engine as Settings › Engines saves it, by the API endpoint's fields until step 1c of task
 * 47 gives the engines their own: without an `id` when it is new, and without a
 * `key` when it keeps the one kept.
 */
export interface ApiEndpointEdit {
  readonly id?: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly key?: string;
  readonly models: readonly ApiEndpointModel[];
}

export interface EngineSettingsEdit {
  readonly apiEndpoints: readonly ApiEndpointEdit[];
  readonly searchEndpoint: SearchEndpoint | null;
  readonly modelPrices: readonly OfferedModel[];
}

export const API_ENDPOINT_NAME_LENGTH = 40;

/** The API engines among `engines`, in their order. */
export function apiEngines(engines: readonly Engine[]): readonly ApiEngine[] {
  return engines.filter((engine): engine is ApiEngine => engine.kind === "openai-compatible-api");
}

/**
 * Every model that may be priced, in order, with its Model price or none: the Claude models while
 * there is a Claude Code engine, then each API engine's.
 */
export function offeredModelPrices({ engines, modelPrices }: EngineSettings): OfferedModel[] {
  const priceOf = (engineId: EngineId | null, model: string) =>
    modelPrices.find((each) => each.engineId === engineId && each.model === model)?.price ?? null;
  return [null, ...apiEngines(engines).map(({ id }) => id)].flatMap((engineId) =>
    modelsPricedUnder(engines, engineId).map((model) => ({
      engineId,
      model,
      price: priceOf(engineId, model),
    })),
  );
}

/** The models priced under a price's `engineId`: null for the Claude models. */
function modelsPricedUnder(
  engines: readonly Engine[],
  engineId: EngineId | null,
): readonly string[] {
  if (engineId === null) {
    return engines.some(({ kind }) => kind === "claude-code") ? CLAUDE_CODE_MODELS : [];
  }
  const engine = engines.find(({ id }) => id === engineId);
  return engine?.kind === "openai-compatible-api" ? offeredModels(engine) : [];
}

/**
 * The settings `edit` makes of `stored`: the Claude Code engines kept, then the API engines in its
 * order, a new one given its id, each keeping its key unless the edit gives one and its default
 * model while it still offers it, and the Model prices of the models offered.
 * Refuses with every reason when they break a rule.
 */
export function changedEngineSettings(
  stored: EngineSettings,
  edit: EngineSettingsEdit,
): EngineSettings {
  const problems: string[] = [];
  const changedApiEngines = changedApiEnginesOf(stored.engines, edit.apiEndpoints, problems);
  for (const engine of changedApiEngines) problems.push(...apiEngineProblems(engine));
  problems.push(...duplicateNameProblems(changedApiEngines));
  const engines = [
    ...stored.engines.filter(({ kind }) => kind === "claude-code"),
    ...changedApiEngines,
  ];
  const searchEndpoint = edit.searchEndpoint && { baseUrl: edit.searchEndpoint.baseUrl.trim() };
  if (searchEndpoint && !isWebAddress(searchEndpoint.baseUrl)) {
    problems.push("Give the search endpoint a base URL starting with http:// or https://.");
  }
  const modelPrices = pricedModels(
    edit.modelPrices,
    (engineId) => modelsPricedUnder(engines, engineId),
    problems,
  );
  if (problems.length > 0) throw new EngineSettingsRefused([...new Set(problems)]);
  return { engines, searchEndpoint, modelPrices };
}

function changedApiEnginesOf(
  stored: readonly Engine[],
  edits: readonly ApiEndpointEdit[],
  problems: string[],
): ApiEngine[] {
  const storedById = new Map(apiEngines(stored).map((engine) => [engine.id, engine]));
  // An API engine never takes the id of another kind's engine.
  const otherIds = stored
    .filter(({ kind }) => kind !== "openai-compatible-api")
    .map(({ id }) => id);
  const taken = new Set([
    ...otherIds,
    ...edits.flatMap(({ id }) => (id === undefined ? [] : [id])),
  ]);
  const seen = new Set<string>();
  return edits.map((edit) => {
    const name = edit.name.trim();
    const kept = edit.id === undefined ? undefined : storedById.get(edit.id);
    if (edit.id !== undefined && (!kept || seen.has(edit.id))) {
      problems.push("The API endpoints changed meanwhile; open Settings › Engines again.");
    }
    const id = edit.id ?? apiEndpointIdFor(name, taken);
    taken.add(id);
    seen.add(id);
    const models = edit.models.map((model) => ({ ...model, id: model.id.trim() }));
    const keptDefault = models.find((model) => model.id === kept?.defaultModel);
    return {
      id,
      name,
      kind: "openai-compatible-api",
      defaultModel: (keptDefault ?? models[0])?.id ?? "",
      baseUrl: edit.baseUrl.trim(),
      key: edit.key?.trim() ?? kept?.key ?? "",
      models,
    };
  });
}

function apiEngineProblems({ id, name, baseUrl, models }: ApiEngine): string[] {
  const problems: string[] = [];
  if (name === "") problems.push("Give each API endpoint a name.");
  else if (id === "") problems.push(`Give "${name}" a name with letters or digits.`);
  if (name.length > API_ENDPOINT_NAME_LENGTH) {
    problems.push(`An API endpoint's name may be at most ${API_ENDPOINT_NAME_LENGTH} characters.`);
  }
  const called = name === "" ? "the API endpoint" : `"${name}"`;
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

function duplicateNameProblems(endpoints: readonly ApiEngine[]): string[] {
  const names = new Set<string>();
  const problems: string[] = [];
  for (const { name } of endpoints) {
    const folded = name.toLowerCase();
    if (name !== "" && names.has(folded)) problems.push(`Two API endpoints are called "${name}".`);
    names.add(folded);
  }
  return problems;
}

function isWebAddress(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === "http:" || protocol === "https:";
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
