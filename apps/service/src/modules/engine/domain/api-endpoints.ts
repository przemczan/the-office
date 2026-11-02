/** A model an API endpoint serves, by its id there, with how many tokens its context holds. */
export interface ApiEndpointModel {
  readonly id: string;
  readonly contextWindow: number;
}

/**
 * Joins and splits an API endpoint's model as the API adapter is handed it until step 1e of task
 * 47 hands every adapter its engine. The endpoint's id never holds it, while a model's id may
 * (`org/model:q4`), so the name is split at its first one.
 */
const MODEL_SEPARATOR = "/";

/** An API endpoint and one of its models, as the API adapter is handed them: `strata/qwen3`. */
export function apiEndpointModel(endpointId: string, modelId: string): string {
  return `${endpointId}${MODEL_SEPARATOR}${modelId}`;
}

/** The API endpoint and the model `apiEndpointModel` joined; undefined when it names no endpoint. */
export function parseApiEndpointModel(
  model: string,
): { readonly endpointId: string; readonly modelId: string } | undefined {
  const at = model.indexOf(MODEL_SEPARATOR);
  if (at <= 0 || at === model.length - 1) return undefined;
  return { endpointId: model.slice(0, at), modelId: model.slice(at + 1) };
}
