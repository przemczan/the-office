import type {
  ApiEndpoint,
  ApiEndpointEdit,
  EngineSettings,
  EngineSettingsEdit,
} from "@the-office/contracts";

/**
 * Settings › Engines as the user edits it before Save: the saved settings with every key kept,
 * since a key is never sent back and an edit without one keeps it.
 */
export function draftOf({
  apiEndpoints,
  searchEndpoint,
  modelPrices,
}: EngineSettings): EngineSettingsEdit {
  return {
    apiEndpoints: apiEndpoints.map(({ id, name, baseUrl, models }) => ({
      id,
      name,
      baseUrl,
      models: models.map((model) => ({ ...model })),
    })),
    searchEndpoint: searchEndpoint && { ...searchEndpoint },
    modelPrices: modelPrices.map(({ price, ...model }) => ({
      ...model,
      price: price && { ...price },
    })),
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
export function searchEndpointOf(baseUrl: string): EngineSettingsEdit["searchEndpoint"] {
  const trimmed = baseUrl.trim();
  return trimmed === "" ? null : { baseUrl: trimmed };
}
