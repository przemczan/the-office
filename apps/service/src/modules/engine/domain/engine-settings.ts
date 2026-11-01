import { apiEndpointIdFor, type ApiEndpoint, type ApiEndpointModel } from "./api-endpoints.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { ENGINE_IDS, modelsOfferedOn } from "./engines.js";
import { pricedModels, type OfferedModel, type PricedModel } from "./model-prices.js";

/** The web search WebSearch goes through for the OpenAI-compatible API: SearXNG's JSON API. */
export interface SearchEndpoint {
  readonly baseUrl: string;
}

/** The engines' Office-wide settings, which Settings › Engines holds (spec §5.4). */
export interface EngineSettings {
  readonly apiEndpoints: readonly ApiEndpoint[];
  /** Null until the user sets one. */
  readonly searchEndpoint: SearchEndpoint | null;
  /** Only the models offered now that have a Model price. */
  readonly modelPrices: readonly PricedModel[];
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  apiEndpoints: [],
  searchEndpoint: null,
  modelPrices: [],
};

/**
 * An API endpoint as Settings › Engines saves it: without an `id` when it is new, and without a
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

/** Every model offered on each engine id, in order, with its Model price or none. */
export function offeredModelPrices({ apiEndpoints, modelPrices }: EngineSettings): OfferedModel[] {
  return ENGINE_IDS.flatMap((engineId) =>
    modelsOfferedOn(engineId, apiEndpoints).map((model) => ({
      engineId,
      model,
      price:
        modelPrices.find((each) => each.engineId === engineId && each.model === model)?.price ??
        null,
    })),
  );
}

/**
 * The settings `edit` makes of `stored`: the API endpoints in its order, a new one given its id,
 * each keeping its key unless the edit gives one, and the Model prices of the models they offer.
 * Refuses with every reason when they break a rule.
 */
export function changedEngineSettings(
  stored: EngineSettings,
  edit: EngineSettingsEdit,
): EngineSettings {
  const problems: string[] = [];
  const apiEndpoints = changedApiEndpoints(stored.apiEndpoints, edit.apiEndpoints, problems);
  for (const endpoint of apiEndpoints) problems.push(...apiEndpointProblems(endpoint));
  problems.push(...duplicateNameProblems(apiEndpoints));
  const searchEndpoint = edit.searchEndpoint && { baseUrl: edit.searchEndpoint.baseUrl.trim() };
  if (searchEndpoint && !isWebAddress(searchEndpoint.baseUrl)) {
    problems.push("Give the search endpoint a base URL starting with http:// or https://.");
  }
  const modelPrices = pricedModels(
    edit.modelPrices,
    (engineId) => modelsOfferedOn(engineId, apiEndpoints),
    problems,
  );
  if (problems.length > 0) throw new EngineSettingsRefused([...new Set(problems)]);
  return { apiEndpoints, searchEndpoint, modelPrices };
}

function changedApiEndpoints(
  stored: readonly ApiEndpoint[],
  edits: readonly ApiEndpointEdit[],
  problems: string[],
): ApiEndpoint[] {
  const storedById = new Map(stored.map((endpoint) => [endpoint.id, endpoint]));
  const taken = new Set(edits.flatMap(({ id }) => (id === undefined ? [] : [id])));
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
    return {
      id,
      name,
      baseUrl: edit.baseUrl.trim(),
      key: edit.key?.trim() ?? kept?.key ?? "",
      models: edit.models.map((model) => ({ ...model, id: model.id.trim() })),
    };
  });
}

function apiEndpointProblems({ id, name, baseUrl, models }: ApiEndpoint): string[] {
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

function duplicateNameProblems(endpoints: readonly ApiEndpoint[]): string[] {
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
