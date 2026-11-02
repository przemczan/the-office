import { parseApiEndpointModel, type ApiEndpointModel } from "./api-endpoints.js";

/** Made from the engine's name when it is added and kept on a rename (spec §5.4). */
export type EngineId = string;

/** What an engine is: a Claude Code account, or an API endpoint of the OpenAI-compatible API. */
export type EngineKind = "claude-code" | "openai-compatible-api";

interface EngineBase {
  readonly id: EngineId;
  readonly name: string;
  /** One of the models the engine offers, which picking the engine fills in. */
  readonly defaultModel: string;
}

/** A Claude Code account, which may run on the `-p` fallback instead of the Agent SDK. */
export interface ClaudeCodeEngine extends EngineBase {
  readonly kind: "claude-code";
  readonly claudeCodeP: boolean;
}

/** An API endpoint of the OpenAI-compatible API. */
export interface ApiEngine extends EngineBase {
  readonly kind: "openai-compatible-api";
  readonly baseUrl: string;
  /** Empty for a server that asks for none, as a local one. Never sent back. */
  readonly key: string;
  readonly models: readonly ApiEndpointModel[];
}

/** An engine the user lists in Settings › Engines (spec §5.4), which caps and usage are kept by. */
export type Engine = ClaudeCodeEngine | ApiEngine;

/** The models the pinned binary offers, on every Claude Code engine, by their ids. */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

/** The Claude Code setup before engines were a list, as the upgrade turns it into a row. */
export const FIRST_CLAUDE_CODE_ENGINE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  claudeCodeP: false,
};

/** The models `engine` offers, by their ids there. */
export function offeredModels(engine: Engine): readonly string[] {
  return engine.kind === "claude-code" ? CLAUDE_CODE_MODELS : engine.models.map(({ id }) => id);
}

/**
 * Whether `engine`'s account has usage windows (spec §5.4): a Claude Code account's. Whether an
 * engine reads them is its adapter's capability (`usageWindows`).
 */
export function hasUsageWindows(engine: Engine): boolean {
  return engine.kind === "claude-code";
}

/**
 * What a Role card names as its engine until step 1c of task 47 makes it an engine id: the Agent
 * SDK or the `-p` fallback, both on the first Claude Code engine, or the OpenAI-compatible API, on
 * the engine its Model field's `<endpoint>/` names.
 */
export const ROLE_ENGINES = ["agent-sdk", "claude-code-p", "openai-compatible-api"] as const;
export type RoleEngine = (typeof ROLE_ENGINES)[number];

/** An engine and one of its models, by its id there. */
export interface EngineModel {
  readonly engineId: EngineId;
  readonly model: string;
}

/**
 * The engine a Role card's engine and Model field run on, with the model by its id there. An API
 * model naming no endpoint stays on the kind's own id, as the upgrade keeps such usage.
 */
export function engineModelOf(roleEngine: RoleEngine, model: string): EngineModel {
  if (roleEngine !== "openai-compatible-api") {
    return { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model };
  }
  const named = parseApiEndpointModel(model);
  return named === undefined
    ? { engineId: roleEngine, model }
    : { engineId: named.endpointId, model: named.modelId };
}
