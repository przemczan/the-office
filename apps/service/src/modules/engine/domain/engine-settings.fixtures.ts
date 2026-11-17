import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  FIRST_OFFICE_DEFAULT,
  type ApiEngineEdit,
  type ClaudeCodeEngineEdit,
  type CodexEngineEdit,
  type EngineEdit,
  type EngineSettings,
  type EngineSettingsEdit,
} from "./engine-settings.js";
import { CodexApiKey } from "./codex-api-key.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { FIRST_CLAUDE_CODE_ENGINE, type ApiEngine, type CodexEngine } from "./engines.js";

// What engine-settings.test.ts and engine-settings.full.test.ts share.

export const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3.8-flash",
  baseUrl: "http://127.0.0.1:8080/v1",
  key: "sk-strata",
  models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
};

/** A Codex engine signed in with an API key. */
export const codex: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  apiKey: CodexApiKey.of("sk-codex-kept"),
};

export function codexEdit(fields: Partial<CodexEngineEdit> = {}): CodexEngineEdit {
  const { id, name, kind, defaultModel } = codex;
  return { id, name, kind, defaultModel, ...fields };
}

export const stored: EngineSettings = {
  ...DEFAULT_ENGINE_SETTINGS,
  engines: [FIRST_CLAUDE_CODE_ENGINE, strata],
};

export function claudeCodeEdit(fields: Partial<ClaudeCodeEngineEdit> = {}): ClaudeCodeEngineEdit {
  return { ...FIRST_CLAUDE_CODE_ENGINE, ...fields };
}

export function strataEdit(fields: Partial<ApiEngineEdit> = {}): ApiEngineEdit {
  const { id, name, kind, defaultModel, baseUrl, models } = strata;
  return { id, name, kind, defaultModel, baseUrl, models, ...fields };
}

/** An edit listing the Claude Code engine, then `engines`, with nothing else set. */
export function editOf(
  engines: readonly EngineEdit[],
  fields: Partial<EngineSettingsEdit> = {},
): EngineSettingsEdit {
  return {
    engines: [claudeCodeEdit(), ...engines],
    officeDefault: FIRST_OFFICE_DEFAULT,
    searchEndpoint: null,
    modelPrices: [],
    ...fields,
  };
}

export function refusal(settings: EngineSettings, edit: EngineSettingsEdit): unknown {
  try {
    changedEngineSettings(settings, edit);
  } catch (error) {
    if (error instanceof EngineSettingsRefused) return error.reasons;
    throw error;
  }
  throw new Error("The settings were kept.");
}
