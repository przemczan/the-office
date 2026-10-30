/** The engines a Role may work with (spec §5.4): the Agent SDK, and the `-p` fallback. */
export const ENGINES = ["agent-sdk", "claude-code-p"] as const;
export type Engine = (typeof ENGINES)[number];

/** Both run the pinned binary the SDK bundles, so they offer the same models, by their ids. */
const PINNED_BINARY_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;

/** The models each engine offers, by the engine's own ids. */
export const ENGINE_MODELS: Readonly<Record<Engine, readonly string[]>> = {
  "agent-sdk": PINNED_BINARY_MODELS,
  "claude-code-p": PINNED_BINARY_MODELS,
};
