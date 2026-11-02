/** A model an API endpoint serves, by its id there, with how many tokens its context holds. */
export interface ApiEndpointModel {
  readonly id: string;
  readonly contextWindow: number;
}

/**
 * Splits a Role's Model field into the endpoint and the model. The endpoint's id never holds it,
 * while a model's id may (`org/model:q4`), so the field is split at its first one.
 */
const MODEL_SEPARATOR = "/";

/** An API endpoint and one of its models, as a Role's Model field names them: `strata/qwen3`. */
export function apiEndpointModel(endpointId: string, modelId: string): string {
  return `${endpointId}${MODEL_SEPARATOR}${modelId}`;
}

/** The API endpoint and the model a Model field names; undefined when it names no endpoint. */
export function parseApiEndpointModel(
  model: string,
): { readonly endpointId: string; readonly modelId: string } | undefined {
  const at = model.indexOf(MODEL_SEPARATOR);
  if (at <= 0 || at === model.length - 1) return undefined;
  return { endpointId: model.slice(0, at), modelId: model.slice(at + 1) };
}

/** Every model the API endpoints offer, as a Role's Model field names them, in their order. */
export function apiEndpointModels(
  endpoints: readonly { readonly id: string; readonly models: readonly ApiEndpointModel[] }[],
): readonly string[] {
  return endpoints.flatMap(({ id, models }) =>
    models.map((model) => apiEndpointModel(id, model.id)),
  );
}

/**
 * The id an endpoint added as `name` is given: its letters and digits, apart from `taken`.
 * Contracts' `apiEndpointIdFor` mirrors it for the web; a change here goes there too.
 */
export function apiEndpointIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
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
