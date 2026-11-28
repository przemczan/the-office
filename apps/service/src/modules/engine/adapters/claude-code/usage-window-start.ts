import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { UsageWindowStart } from "../../ports/agent-engine.js";
import type { TokenUsage } from "../../ports/session-events.js";

/** The model the turn that starts a Claude Code engine's 5-hour window runs on: the cheapest. */
export const WINDOW_START_MODEL = "claude-haiku-5-5";

/** The tokens a turn's result counts. */
export function resultTokens(result: SDKResultMessage): TokenUsage {
  return {
    input: result.usage.input_tokens,
    output: result.usage.output_tokens,
    cacheRead: result.usage.cache_read_input_tokens,
    cacheCreation: result.usage.cache_creation_input_tokens,
  };
}

/**
 * The window start a turn's messages tell: its result's tokens, once it succeeded. Fails on a
 * failed turn, and when the messages end with no result.
 */
export async function windowStartOf(
  messages: AsyncIterable<SDKMessage>,
): Promise<UsageWindowStart> {
  for await (const message of messages) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success" || message.is_error) {
      const reasons = message.subtype === "success" ? [message.result] : message.errors;
      throw new Error(`The turn that starts the 5-hour window failed: ${reasons.join("; ")}`);
    }
    return { tokens: resultTokens(message), model: WINDOW_START_MODEL };
  }
  throw new Error("The engine ended before the turn that starts the 5-hour window did.");
}
