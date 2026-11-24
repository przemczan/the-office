import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

/** A full Claude model id, such as `claude-opus-5-5`, as The Office names Claude models. */
const CLAUDE_MODEL_ID = /^claude-[a-z0-9.-]+$/;

/**
 * The models a Claude Code account lists, as the binary's `initialize` answers them (the SDK's
 * `supportedModels()`), by their full ids: each row's resolved id, else its own value, keeping only
 * full Claude model ids (an alias such as `opusplan` resolving to none is left out), each once, in
 * the account's order. Undefined when none is left, so the engine's kept or fixed list stands.
 */
export function listedClaudeModels(
  rows: readonly Pick<ModelInfo, "value" | "resolvedModel">[] | undefined,
): readonly string[] | undefined {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    const id = row.resolvedModel ?? row.value;
    if (CLAUDE_MODEL_ID.test(id)) ids.add(id);
  }
  return ids.size === 0 ? undefined : [...ids];
}
