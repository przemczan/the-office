import type { Effort, EngineId } from "@the-office/contracts";

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

/** A model as a person reads it: "Opus 5.5" for a Claude model, any other by its id. */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}
