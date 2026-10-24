import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** `denied` is a permission refusal; `failed` is any other error result, such as a missing file. */
export type ToolCallOutcome = "allowed" | "denied" | "failed" | "unanswered";

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly outcome: ToolCallOutcome;
}

/** Every tool call the model made in the session, with how the engine answered it. */
export function toolCalls(messages: readonly SDKMessage[]): ToolCall[] {
  const answers = toolResults(messages);
  const denied = new Set(
    messages.flatMap((message) => (message.type === "result" ? message.permission_denials.map((denial) => denial.tool_use_id) : [])),
  );
  return messages.flatMap((message) =>
    message.type === "assistant"
      ? message.message.content.flatMap((block) =>
          block.type === "tool_use"
            ? [
                {
                  id: block.id,
                  name: block.name,
                  input: block.input as Record<string, unknown>,
                  outcome: denied.has(block.id) ? "denied" : (answers.get(block.id) ?? "unanswered"),
                },
              ]
            : [],
        )
      : [],
  );
}

function toolResults(messages: readonly SDKMessage[]): Map<string, ToolCallOutcome> {
  const results = new Map<string, ToolCallOutcome>();
  for (const message of messages) {
    if (message.type !== "user" || typeof message.message.content === "string") {
      continue;
    }
    for (const block of message.message.content) {
      if (block.type === "tool_result") {
        results.set(block.tool_use_id, block.is_error === true ? "failed" : "allowed");
      }
    }
  }
  return results;
}
