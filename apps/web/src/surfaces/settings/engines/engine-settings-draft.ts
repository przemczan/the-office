import {
  apiEndpointIdFor,
  apiEndpointModel,
  type ApiEndpoint,
  type ApiEndpointEdit,
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
  readonly apiEndpoints: readonly ApiEndpointEdit[];
  readonly searchEndpoint: SearchEndpoint | null;
  /**
   * Each model's Model price as its fields read, by `offeredModelKey`. Kept apart from the models
   * offered, so only those offered when Saving are sent.
   */
  readonly modelPrices: Readonly<Record<string, ModelPriceText>>;
}

/** A model offered on an engine id, as the Model prices card lists it. */
export type PricedModel = Pick<OfferedModel, "engineId" | "model">;

export function draftOf({
  apiEndpoints,
  searchEndpoint,
  modelPrices,
}: EngineSettings): EngineSettingsDraft {
  return {
    apiEndpoints: apiEndpoints.map(({ id, name, baseUrl, models }) => ({
      id,
      name,
      baseUrl,
      models: models.map((model) => ({ ...model })),
    })),
    searchEndpoint: searchEndpoint && { ...searchEndpoint },
    modelPrices: Object.fromEntries(
      modelPrices.flatMap((offered) =>
        offered.price ? [[offeredModelKey(offered), priceTextOf(offered.price)]] : [],
      ),
    ),
  };
}

export function offeredModelKey({ engineId, model }: PricedModel): string {
  return `${engineId} ${model}`;
}

/**
 * The drafted API endpoints with the ids Save gives them, in order: a new one's made from its
 * name, so its models read by name and a price typed before Save lands on them.
 */
export function draftedEndpoints(
  apiEndpoints: readonly ApiEndpointEdit[],
): readonly (ApiEndpointEdit & { readonly id: string })[] {
  const taken = new Set(apiEndpoints.flatMap(({ id }) => (id === undefined ? [] : [id])));
  return apiEndpoints.map((endpoint) => {
    const id = endpoint.id ?? apiEndpointIdFor(endpoint.name, taken);
    taken.add(id);
    return { ...endpoint, id, name: endpoint.name.trim() };
  });
}

/**
 * Every model the draft offers, as Save prices them: the Claude Code engines' as `saved` lists
 * them, then each drafted API endpoint's, each once; one without an id yet is left out.
 */
export function offeredModelsOf(
  draft: EngineSettingsDraft,
  saved: EngineSettings,
): readonly PricedModel[] {
  const claudeCode = saved.modelPrices
    .filter(({ engineId }) => engineId !== "openai-compatible-api")
    .map(({ engineId, model }) => ({ engineId, model }));
  const apiModels = draftedEndpoints(draft.apiEndpoints).flatMap(({ id: endpointId, models }) =>
    models
      .map(({ id }) => id.trim())
      .filter((modelId) => endpointId !== "" && modelId !== "")
      .map((modelId) => apiEndpointModel(endpointId, modelId)),
  );
  return [
    ...claudeCode,
    ...[...new Set(apiModels)].map((model) => ({
      engineId: "openai-compatible-api",
      model,
    })),
  ];
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
    apiEndpoints: [...draft.apiEndpoints],
    searchEndpoint: draft.searchEndpoint,
    modelPrices,
  };
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
    apiEndpoints: draft.apiEndpoints,
    searchEndpoint: draft.searchEndpoint,
    modelPrices: offeredModelsOf(draft, saved).map((offered) => priceTextIn(draft, offered)),
  };
}

export const NEW_API_ENDPOINT: ApiEndpointEdit = {
  name: "",
  baseUrl: "",
  models: [{ id: "", contextWindow: 0 }],
};

/** What saving does with an API endpoint's key: kept as it is, a new one, or none. */
export type KeyOnSave = "kept-set" | "kept-none" | "new" | "removed";

export function keyOnSave(edit: ApiEndpointEdit, saved: ApiEndpoint | undefined): KeyOnSave {
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
