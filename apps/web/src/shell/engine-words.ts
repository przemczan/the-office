import { COPILOT_CLI_AUTO_MODEL, type Effort, type EngineKind } from "@the-office/contracts";

/** The words for an engine type, a model and its effort, wherever the web names them. */

/** Each engine type as a person reads it, in the order the spec lists the types. */
export const ENGINE_KIND_LABELS: Readonly<Record<EngineKind, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "Copilot CLI",
  "gemini-cli": "Gemini CLI",
  "openai-compatible-api": "API endpoint",
};

/** Each engine type's icon: in Settings › Engines' rows, "Add an engine" and the type pickers. */
export const ENGINE_KIND_ICONS: Readonly<Record<EngineKind, string>> = {
  "claude-code": "terminal",
  codex: "bot",
  "copilot-cli": "github",
  "gemini-cli": "sparkles",
  "openai-compatible-api": "server",
};

/** The engine types in the spec's order: Claude Code, Codex, Copilot CLI, Gemini CLI, API endpoint. */
export const ENGINE_KINDS = Object.keys(ENGINE_KIND_LABELS) as readonly EngineKind[];

export const EFFORT_LABELS: Readonly<Record<Effort, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** The Gemini CLI's model aliases besides Auto, as its own docs name them. */
const GEMINI_CLI_MODEL_LABELS: Readonly<Record<string, string>> = {
  pro: "Pro",
  flash: "Flash",
  "flash-lite": "Flash-Lite",
};

/**
 * A model as a person reads it: "Opus 5.5" for a Claude model, "Auto" for Copilot CLI's and Gemini
 * CLI's, "Flash-Lite" for a Gemini CLI alias, any other by its id.
 */
export function modelLabel(model: string): string {
  if (model === COPILOT_CLI_AUTO_MODEL) return "Auto";
  const geminiCliLabel = GEMINI_CLI_MODEL_LABELS[model];
  if (geminiCliLabel !== undefined) return geminiCliLabel;
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = "", major, minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

/**
 * A model kept where it was chosen though its engines no longer offer it: "Opus 5.5 · No longer
 * offered".
 */
export function noLongerOfferedModelLabel(model: string): string {
  return `${modelLabel(model)} · No longer offered`;
}

/** "Opus 5.5 on Personal": the model a run's session ran and the engine it ran on. */
export function runEngineWords({
  model,
  engineName,
}: {
  readonly model: string;
  readonly engineName: string;
}): string {
  return `${modelLabel(model)} on ${engineName}`;
}

/** "Stand-in for Work": a run's badge when its engine stood in for the cascade's. */
export function standInForWords(engineName: string): string {
  return `Stand-in for ${engineName}`;
}
