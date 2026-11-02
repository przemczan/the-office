import {
  parseApiEndpointModel,
  type Effort,
  type Engine,
  type EngineId,
} from "@the-office/contracts";

/** The words for a model and its effort, wherever a Role card or a Stage names them. */

const ENGINE_ID_LABELS: Readonly<Record<EngineId, string>> = {
  "claude-code": "Claude Code engines",
  "openai-compatible-api": "OpenAI-compatible API",
};

/** What an engine id spends on, as caps and Usage estimates name it; an unknown id as it is. */
export function engineIdLabel(engineId: EngineId): string {
  return ENGINE_ID_LABELS[engineId] ?? engineId;
}

export const EFFORT_LABELS: Readonly<Record<Effort, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/**
 * A model as a person reads it: "Opus 5.5" on the Claude Code engines, "Strata · org/coder:q4" for
 * one of the API endpoints' models; one naming no endpoint listed now stays as it is.
 */
export function modelLabel(
  model: string,
  engines: readonly Pick<Engine, "id" | "name">[] = [],
): string {
  const named = parseApiEndpointModel(model);
  const endpoint = named && engines.find(({ id }) => id === named.endpointId);
  if (named && endpoint) return `${endpoint.name} · ${named.modelId}`;
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}
