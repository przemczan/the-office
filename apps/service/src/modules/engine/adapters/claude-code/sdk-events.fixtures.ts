import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// What sdk-events.test.ts and sdk-events.full.test.ts share.

/** Stream messages as the engine sends them, with only the fields the mapping reads. */
export const message = (fields: Record<string, unknown>): SDKMessage =>
  fields as unknown as SDKMessage;

export const RESULT = {
  type: "result",
  duration_ms: 1200,
  num_turns: 1,
  usage: {
    input_tokens: 4,
    output_tokens: 12,
    cache_read_input_tokens: 24_600,
    cache_creation_input_tokens: 180,
  },
  total_cost_usd: 0.0042,
  modelUsage: {},
  permission_denials: [],
  user_message_uuids: ["brief", "barge-in"],
  session_id: "session",
};
