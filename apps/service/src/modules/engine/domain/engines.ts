import type { ApiEndpointModel } from "./api-endpoints.js";
import type { CodexApiKey } from "./codex-api-key.js";
import type { CopilotCliToken } from "./copilot-cli-token.js";
import type { GeminiApiKey } from "./gemini-api-key.js";

/** Made from the engine's name when it is added and kept on a rename (spec §5.4). */
export type EngineId = string;

/**
 * What an engine is: a Claude Code account, an API endpoint of the OpenAI-compatible API, an
 * OpenAI account on Codex, a GitHub account with Copilot on the Copilot CLI, or a Gemini API key on
 * the Gemini CLI.
 */
export type EngineKind =
  "claude-code" | "openai-compatible-api" | "codex" | "copilot-cli" | "gemini-cli";

/** Each engine type as the user reads it, in words such as a refusal's. */
export const ENGINE_TYPE_NAMES: Readonly<Record<EngineKind, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "Copilot CLI",
  "gemini-cli": "Gemini CLI",
  "openai-compatible-api": "API endpoint",
};

/** How hard the model thinks. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The efforts each engine type takes, in order, as its runtime takes them (spec §5.4.5, "Models and
 * efforts of an engine type"); a type that takes none shows no Effort anywhere. Contracts'
 * `ENGINE_TYPE_EFFORTS` mirrors it for the web; a change here goes there too.
 */
const EFFORTS_BY_ENGINE_TYPE: Readonly<Record<EngineKind, readonly Effort[]>> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  "copilot-cli": [],
  "gemini-cli": [],
  "openai-compatible-api": [],
};

export function effortsTakenBy(kind: EngineKind): readonly Effort[] {
  return EFFORTS_BY_ENGINE_TYPE[kind];
}

interface EngineBase {
  readonly id: EngineId;
  readonly name: string;
  /** One of the models the engine offers, which picking the engine fills in. */
  readonly defaultModel: string;
  /** One of the efforts its type takes; null, Not set, leaves it to the engine type. */
  readonly defaultEffort: Effort | null;
}

/**
 * An engine whose account lists its models (`listsItsModels`). The list is kept per engine apart
 * from the settings, so only the engines `EngineModels` lists carry it (`recordModelList`).
 */
interface EngineListingItsModels extends EngineBase {
  /**
   * The models its account listed when last asked, by their ids; absent until it first answered,
   * when its type's fixed list stands in (`offeredModels`).
   */
  readonly listedModels?: readonly string[];
}

/** A Claude Code account, which may run on the `-p` fallback instead of the Agent SDK. */
export interface ClaudeCodeEngine extends EngineListingItsModels {
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
export interface CodexEngine extends EngineListingItsModels {
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
export interface CopilotCliEngine extends EngineListingItsModels {
  readonly kind: "copilot-cli";
  /**
   * The token "Paste a token instead" signed it in with, kept so; null when a Sign in or nothing
   * signs it in. Never sent back, and a Save of Settings › Engines keeps it.
   */
  readonly token: CopilotCliToken | null;
}

/**
 * A Gemini API key from Google AI Studio, whose sessions run on the pinned `@google/gemini-cli`
 * (spec §5.4.7).
 */
export interface GeminiCliEngine extends EngineBase {
  readonly kind: "gemini-cli";
  /**
   * The key that signs it in; null until one is given. Never sent back, and a Save of Settings ›
   * Engines keeps it.
   */
  readonly apiKey: GeminiApiKey | null;
}

/** An engine the user lists in Settings › Engines (spec §5.4), which caps and usage are kept by. */
export type Engine =
  ClaudeCodeEngine | ApiEngine | CodexEngine | CopilotCliEngine | GeminiCliEngine;

/**
 * The models a Claude Code engine offers until its account first lists its own (spec §5.4.5,
 * "Models an engine lists"), by their ids.
 */
export const CLAUDE_CODE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

/**
 * The models a Codex engine offers until its account first lists its own, by their ids, as the
 * engine check's `model/list` showed them for a ChatGPT sign-in (docs/engine-check.md,
 * `codex.start`), its hidden ones left out.
 */
export const CODEX_MODELS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

/**
 * Auto, the Copilot CLI engine's model that names none and lets the runtime choose: its default,
 * as a token-signed account may list no models and the runtime refuses any model it doesn't list.
 */
export const COPILOT_CLI_AUTO_MODEL = "auto";

/**
 * The models a Copilot CLI engine offers until its account first lists its own: Auto alone, which
 * stays first once it does.
 */
export const COPILOT_CLI_MODELS = [COPILOT_CLI_AUTO_MODEL] as const;

/**
 * The models a Gemini CLI engine offers: the pinned CLI's own aliases, which it resolves to the
 * newest Gemini model of each line the key may use, so a new model comes with the CLI, not with a
 * list kept here (spec §5.4.7). Auto, its default, lets the CLI pick per request.
 */
export const GEMINI_CLI_MODELS = ["auto", "pro", "flash", "flash-lite"] as const;

/** The Claude Code setup before engines were a list, as the upgrade turns it into a row. */
export const FIRST_CLAUDE_CODE_ENGINE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  defaultEffort: null,
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

/**
 * The models `engine` offers, by their ids there: those its account listed when last asked, else
 * its type's fixed list; a Copilot CLI engine's with Auto first.
 */
export function offeredModels(engine: Engine): readonly string[] {
  switch (engine.kind) {
    case "claude-code":
      return engine.listedModels ?? CLAUDE_CODE_MODELS;
    case "codex":
      return engine.listedModels ?? CODEX_MODELS;
    case "copilot-cli":
      return engine.listedModels === undefined
        ? COPILOT_CLI_MODELS
        : [
            COPILOT_CLI_AUTO_MODEL,
            ...engine.listedModels.filter((model) => model !== COPILOT_CLI_AUTO_MODEL),
          ];
    case "gemini-cli":
      return GEMINI_CLI_MODELS;
    case "openai-compatible-api":
      return engine.models.map(({ id }) => id);
  }
}

/**
 * Whether an engine of `kind` is asked which models its account offers (spec §5.4.5, "Models an
 * engine lists"): a Claude Code, Codex or Copilot CLI engine is; a Gemini CLI engine offers the
 * CLI's aliases and an API endpoint the models the user gives it.
 */
export function listsItsModels(kind: EngineKind): boolean {
  return kind === "claude-code" || kind === "codex" || kind === "copilot-cli";
}

/**
 * Whether `engine`'s account has usage windows (spec §5.4): a Claude Code account's and a Codex
 * account's, each unless an API key signs it in; never a Copilot CLI account's, by decision, nor a
 * Gemini API key's. Whether an engine reads them is its adapter's capability (`usageWindows`).
 */
export function hasUsageWindows(engine: Engine): boolean {
  switch (engine.kind) {
    case "claude-code":
      return engine.signedInByApiKey !== true;
    case "codex":
      return engine.apiKey === null;
    case "copilot-cli":
    case "gemini-cli":
    case "openai-compatible-api":
      return false;
  }
}

/**
 * Whether `engine`'s models are priced on it alone (spec §5.4): an API engine's, a Copilot CLI
 * engine's and a Gemini CLI engine's are; the Claude and Codex models share one price across their
 * engines.
 */
export function pricedPerEngine(engine: Engine): boolean {
  return (
    engine.kind === "openai-compatible-api" ||
    engine.kind === "copilot-cli" ||
    engine.kind === "gemini-cli"
  );
}

/** An engine and one of its models, by its id there. */
export interface EngineModel {
  readonly engineId: EngineId;
  readonly model: string;
}

/**
 * The Office default: an engine type and one of its accounts, an engine of that type, whose own
 * default model it runs on (spec §5.4.5, "The engine cascade").
 */
export interface OfficeDefault {
  readonly engineType: EngineKind;
  readonly engineId: EngineId;
}
