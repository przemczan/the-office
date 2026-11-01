import { apiEndpointModels, type ApiEndpoint } from "./api-endpoints.js";

/**
 * The engines a Role may work with (spec §5.4): the Agent SDK, the `-p` fallback, and The Office's
 * own agent loop on the OpenAI-compatible API.
 */
export const ENGINES = ["agent-sdk", "claude-code-p", "openai-compatible-api"] as const;
export type Engine = (typeof ENGINES)[number];

/**
 * An engine as the user will list it (spec §8, task 47): what caps, readings and each day's use are
 * kept by. The two Claude Code engines spend one account's credits, so they share an id. Kept in
 * the database, so an id never changes.
 */
export type EngineId = "claude-code" | "openai-compatible-api";

// The one place an engine's kind gives its id, which task 47 replaces with the engines the user adds.
const ENGINE_ID_OF_ENGINE: Readonly<Record<Engine, EngineId>> = {
  "agent-sdk": "claude-code",
  "claude-code-p": "claude-code",
  "openai-compatible-api": "openai-compatible-api",
};

/** The engine `engine`'s sessions spend on. */
export function engineIdOf(engine: Engine): EngineId {
  return ENGINE_ID_OF_ENGINE[engine];
}

/** Both run the pinned binary the SDK bundles, so they offer the same models, by their ids. */
const PINNED_BINARY_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;

const OFFERED_MODELS: Readonly<
  Record<Engine, (apiEndpoints: readonly ApiEndpoint[]) => readonly string[]>
> = {
  "agent-sdk": () => PINNED_BINARY_MODELS,
  "claude-code-p": () => PINNED_BINARY_MODELS,
  "openai-compatible-api": (apiEndpoints) => apiEndpointModels(apiEndpoints),
};

/** The models `engine` offers with these API endpoints, as a Role's Model field names them. */
export function offeredModels(
  engine: Engine,
  apiEndpoints: readonly ApiEndpoint[],
): readonly string[] {
  return OFFERED_MODELS[engine](apiEndpoints);
}

/** The engine ids, each once, in the order of `ENGINES`. */
export const ENGINE_IDS: readonly EngineId[] = [...new Set(ENGINES.map(engineIdOf))];

/** The models offered on `engineId` by every engine spending on it, each once. */
export function modelsOfferedOn(
  engineId: EngineId,
  apiEndpoints: readonly ApiEndpoint[],
): readonly string[] {
  const engines = ENGINES.filter((engine) => engineIdOf(engine) === engineId);
  return [...new Set(engines.flatMap((engine) => offeredModels(engine, apiEndpoints)))];
}
