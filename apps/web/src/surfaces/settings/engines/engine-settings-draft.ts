import {
  engineIdFor,
  type ApiEngine,
  type ApiEngineEdit,
  type ClaudeCodeEngineEdit,
  type EngineId,
  type EngineModel,
  type EngineSettings,
  type EngineSettingsEdit,
  type OfferedModel,
  type SearchEndpoint,
} from "@the-office/contracts";
import { NO_PRICE_TEXT, priceOf, priceTextOf, type ModelPriceText } from "./model-price-fields.ts";

/**
 * Settings › Engines as the user edits it before Save: the saved settings with every key kept,
 * since a key is never sent back and an edit without one keeps it.
 */
export interface EngineSettingsDraft {
  /** Sent back as saved: Settings › Engines lists them in step 1f of task 47. */
  readonly claudeCodeEngines: readonly ClaudeCodeEngineEdit[];
  readonly apiEndpoints: readonly ApiEngineEdit[];
  readonly officeDefault: EngineModel;
  readonly searchEndpoint: SearchEndpoint | null;
  /**
   * Each model's Model price as its fields read, by `offeredModelKey`. Kept apart from the models
   * offered, so only those offered when Saving are sent.
   */
  readonly modelPrices: Readonly<Record<string, ModelPriceText>>;
}

/** A model the Model prices card lists; a Claude model's engine is null. */
export type PricedModel = Pick<OfferedModel, "engineId" | "model">;

/** A drafted API endpoint with the id Save gives it. */
export type DraftedEndpoint = ApiEngineEdit & { readonly id: EngineId };

export function draftOf({
  engines,
  officeDefault,
  searchEndpoint,
  modelPrices,
}: EngineSettings): EngineSettingsDraft {
  return {
    claudeCodeEngines: engines.flatMap((engine) =>
      engine.kind === "claude-code" ? [{ ...engine }] : [],
    ),
    apiEndpoints: savedApiEngines(engines).map(({ keySet: _keySet, models, ...engine }) => ({
      ...engine,
      models: models.map((model) => ({ ...model })),
    })),
    officeDefault: { ...officeDefault },
    searchEndpoint: searchEndpoint && { ...searchEndpoint },
    modelPrices: Object.fromEntries(
      modelPrices.flatMap((offered) =>
        offered.price ? [[offeredModelKey(offered), priceTextOf(offered.price)]] : [],
      ),
    ),
  };
}

/** The API engines among the saved engines, in order. */
export function savedApiEngines(engines: EngineSettings["engines"]): readonly ApiEngine[] {
  return engines.filter((engine): engine is ApiEngine => engine.kind === "openai-compatible-api");
}

export function offeredModelKey({ engineId, model }: PricedModel): string {
  return JSON.stringify([engineId, model]);
}

/**
 * The drafted API endpoints with the ids Save gives them, in order: a new one's made from its
 * name, apart from every saved engine's and every drafted one's, so its models read by name and a
 * price typed before Save lands on them.
 */
export function draftedEndpoints(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly DraftedEndpoint[] {
  const taken = new Set([
    ...saved.engines.map(({ id }) => id),
    ...draft.apiEndpoints.flatMap(({ id }) => (id === undefined ? [] : [id])),
  ]);
  return draft.apiEndpoints.map((endpoint) => {
    const id = endpoint.id ?? engineIdFor(endpoint.name, taken);
    taken.add(id);
    return { ...endpoint, id, name: endpoint.name.trim() };
  });
}

/**
 * Every model the draft offers, as Save prices them: the Claude models as `saved` lists them,
 * then each drafted API endpoint's, each once; one without an id yet is left out.
 */
export function offeredModelsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly PricedModel[] {
  const claudeModels = saved.modelPrices
    .filter(({ engineId }) => engineId === null)
    .map(({ engineId, model }) => ({ engineId, model }));
  const apiModels = draftedEndpoints(draft, saved).flatMap(({ id: engineId, models }) =>
    [...new Set(models.map(({ id }) => id.trim()))]
      .filter((model) => engineId !== "" && model !== "")
      .map((model) => ({ engineId, model })),
  );
  return [...claudeModels, ...apiModels];
}

/** A model's price fields in the draft: empty for a model without a price. */
export function priceTextIn(draft: EngineSettingsDraft, offered: PricedModel): ModelPriceText {
  return draft.modelPrices[offeredModelKey(offered)] ?? NO_PRICE_TEXT;
}

/** What Save sends, or undefined while a Model price's fields don't read as one. */
export function engineSettingsEditOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): EngineSettingsEdit | undefined {
  const modelPrices: OfferedModel[] = [];
  for (const offered of offeredModelsOf(draft, saved)) {
    const price = priceOf(priceTextIn(draft, offered));
    if (price === undefined) return undefined;
    modelPrices.push({ ...offered, price });
  }
  return {
    engines: [...draft.claudeCodeEngines, ...draft.apiEndpoints.map(withOfferedDefaultModel)],
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices,
  };
}

/**
 * The endpoint with a default model it offers: the one it has while it still lists it, else its
 * first, until Settings › Engines lets the user pick it.
 */
function withOfferedDefaultModel(endpoint: ApiEngineEdit): ApiEngineEdit {
  const models = endpoint.models.map(({ id }) => id.trim());
  const defaultModel = models.includes(endpoint.defaultModel)
    ? endpoint.defaultModel
    : (models[0] ?? "");
  return { ...endpoint, defaultModel };
}

/** Whether Save would change anything; a price typed for a model no longer offered doesn't count. */
export function draftChanged(draft: EngineSettingsDraft, saved: EngineSettings): boolean {
  return (
    JSON.stringify(whatSaveSees(draft, saved)) !==
    JSON.stringify(whatSaveSees(draftOf(saved), saved))
  );
}

function whatSaveSees(draft: EngineSettingsDraft, saved: EngineSettings): unknown {
  return {
    claudeCodeEngines: draft.claudeCodeEngines,
    apiEndpoints: draft.apiEndpoints,
    officeDefault: draft.officeDefault,
    searchEndpoint: draft.searchEndpoint,
    modelPrices: offeredModelsOf(draft, saved).map((offered) => priceTextIn(draft, offered)),
  };
}

export const NEW_API_ENDPOINT: ApiEngineEdit = {
  name: "",
  kind: "openai-compatible-api",
  defaultModel: "",
  baseUrl: "",
  models: [{ id: "", contextWindow: 0 }],
};

/** What saving does with an API endpoint's key: kept as it is, a new one, or none. */
export type KeyOnSave = "kept-set" | "kept-none" | "new" | "removed";

export function keyOnSave(edit: ApiEngineEdit, saved: ApiEngine | undefined): KeyOnSave {
  if (edit.key === undefined) return saved?.keySet ? "kept-set" : "kept-none";
  if (edit.key !== "") return "new";
  return saved?.keySet ? "removed" : "kept-none";
}

export const KEY_ON_SAVE_WORDS: Readonly<Record<KeyOnSave, string>> = {
  "kept-set": "A key is set. It is never shown; type a new one to replace it.",
  "kept-none": "No key, as a local server needs none.",
  new: "The key you typed is kept on Save.",
  removed: "The key is removed on Save.",
};

/** The Search endpoint as its base URL field reads it: none while the field is empty. */
export function searchEndpointOf(baseUrl: string): SearchEndpoint | null {
  const trimmed = baseUrl.trim();
  return trimmed === "" ? null : { baseUrl: trimmed };
}
