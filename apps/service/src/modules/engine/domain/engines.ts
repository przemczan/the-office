import type { ApiEndpointModel } from "./api-endpoints.js";
import type { CodexApiKey } from "./codex-api-key.js";
import type { CopilotCliToken } from "./copilot-cli-token.js";

/** Made from the engine's name when it is added and kept on a rename (spec §5.4). */
export type EngineId = string;

/**
 * What an engine is: a Claude Code account, an API endpoint of the OpenAI-compatible API, an
 * OpenAI account on Codex, or a GitHub account with Copilot on the Copilot CLI.
 */
export type EngineKind = "claude-code" | "openai-compatible-api" | "codex" | "copilot-cli";

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
  /**
   * An Anthropic API key signs it in ("Use an API key"). The key is kept in the engine's folder,
   * not the settings, so only the engines `EngineModels` lists tell it (`recordApiKeySignIn`);
   * absent reads as not.
   */
  readonly signedInByApiKey?: boolean;
}

/** An API endpoint of the OpenAI-compatible API. */
export interface ApiEngine extends EngineBase {
  readonly kind: "openai-compatible-api";
  readonly baseUrl: string;
  /** Empty for a server that asks for none, as a local one. Never sent back. */
  readonly key: string;
  readonly models: readonly ApiEndpointModel[];
}

/** An OpenAI account, whose sessions run on the pinned `codex app-server` (spec §5.4). */
export interface CodexEngine extends EngineBase {
  readonly kind: "codex";
  /**
   * The OpenAI API key "Use an API key instead" signed it in with, kept so; null when a ChatGPT
   * sign-in or nothing signs it in. Never sent back, and a Save of Settings › Engines keeps it.
   */
  readonly apiKey: CodexApiKey | null;
}

/**
 * A GitHub account with Copilot, whose sessions run on the Copilot CLI runtime the pinned
 * `@microsoft/copilot-sdk` bundles (spec §5.4, "The Copilot CLI engine").
 */
export interface CopilotCliEngine extends EngineBase {
  readonly kind: "copilot-cli";
  /**
   * The token "Paste a token instead" signed it in with, kept so; null when a Sign in or nothing
   * signs it in. Never sent back, and a Save of Settings › Engines keeps it.
   */
  readonly token: CopilotCliToken | null;
}

/** An engine the user lists in Settings › Engines (spec §5.4), which caps and usage are kept by. */
export type Engine = ClaudeCodeEngine | ApiEngine | CodexEngine | CopilotCliEngine;

/** The models the pinned binary offers, on every Claude Code engine, by their ids. */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

/**
 * The models the pinned Codex offers a ChatGPT sign-in, by their ids, as the engine check's
 * `model/list` showed them (docs/engine-check.md, `codex.start`), its hidden ones left out.
 */
export const CODEX_MODELS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

/**
 * Auto, the Copilot CLI engine's model that names none and lets the runtime choose: its default,
 * as a token-signed account may list no models and the runtime refuses any model it doesn't list.
 */
export const COPILOT_CLI_AUTO_MODEL = "auto";

/**
 * The models a Copilot CLI engine offers. Spec §5.4 adds those the runtime lists for the account;
 * until its adapter reads them, Auto alone.
 */
export const COPILOT_CLI_MODELS = [COPILOT_CLI_AUTO_MODEL] as const;

/** The Claude Code setup before engines were a list, as the upgrade turns it into a row. */
export const FIRST_CLAUDE_CODE_ENGINE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  claudeCodeP: false,
};

/**
 * The id an engine added as `name` is given: its letters and digits, apart from `taken`.
 * Contracts' `engineIdFor` mirrors it for the web; a change here goes there too.
 */
export function engineIdFor(name: string, taken: ReadonlySet<string>): string {
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

/** The models `engine` offers, by their ids there. */
export function offeredModels(engine: Engine): readonly string[] {
  switch (engine.kind) {
    case "claude-code":
      return CLAUDE_CODE_MODELS;
    case "codex":
      return CODEX_MODELS;
    case "copilot-cli":
      return COPILOT_CLI_MODELS;
    case "openai-compatible-api":
      return engine.models.map(({ id }) => id);
  }
}

/**
 * Whether `engine`'s account has usage windows (spec §5.4): a Claude Code account's and a Codex
 * account's, each unless an API key signs it in; never a Copilot CLI account's, by decision.
 * Whether an engine reads them is its adapter's capability (`usageWindows`).
 */
export function hasUsageWindows(engine: Engine): boolean {
  switch (engine.kind) {
    case "claude-code":
      return engine.signedInByApiKey !== true;
    case "codex":
      return engine.apiKey === null;
    case "copilot-cli":
    case "openai-compatible-api":
      return false;
  }
}

/**
 * Whether `engine`'s models are priced on it alone (spec §5.4): an API engine's and a Copilot CLI
 * engine's are; the Claude and Codex models share one price across their engines.
 */
export function pricedPerEngine(engine: Engine): boolean {
  return engine.kind === "openai-compatible-api" || engine.kind === "copilot-cli";
}

/** An engine and one of its models, by its id there. */
export interface EngineModel {
  readonly engineId: EngineId;
  readonly model: string;
}
