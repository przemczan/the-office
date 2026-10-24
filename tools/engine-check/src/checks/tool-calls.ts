import type { SDKMessage, SDKPermissionDeniedMessage } from "@anthropic-ai/claude-agent-sdk";
import { samePath } from "./paths.ts";

/** `denied` is a permission refusal; `failed` is any other error result, such as a missing file. */
export type ToolCallOutcome = "allowed" | "denied" | "failed" | "unanswered";

/** A call a check asked for that the model never made. */
export type AttemptOutcome = ToolCallOutcome | "not attempted";

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly outcome: ToolCallOutcome;
}

/** Every tool call the model made in the session, a subagent's included, with how the engine answered it. */
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

/** The outcome of the latest of `calls`, the retry when the model tried twice. */
export function lastOutcome(calls: readonly ToolCall[]): AttemptOutcome {
  return calls.at(-1)?.outcome ?? "not attempted";
}

/** Calls of the file tool `name` on `path`. */
export function callsOn(calls: readonly ToolCall[], name: string, path: string): ToolCall[] {
  return calls.filter((call) => {
    const target = targetPath(call.input);
    return call.name === name && target !== undefined && samePath(target, path);
  });
}

/** What a file tool works on: a file for Read, Write and Edit, a folder for Grep and Glob. */
export function targetPath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) {
    return undefined;
  }
  const { file_path: filePath, path } = toolInput as { file_path?: unknown; path?: unknown };
  const target = filePath ?? path;
  return typeof target === "string" ? target : undefined;
}

/** Index of the message holding the call's result, -1 while it has none. */
export function toolResultIndex(messages: readonly SDKMessage[], toolUseId: string): number {
  return messages.findIndex(
    (message) =>
      message.type === "user" &&
      typeof message.message.content !== "string" &&
      message.message.content.some((block) => block.type === "tool_result" && block.tool_use_id === toolUseId),
  );
}

/** The text the model read as the call's result. */
export function toolResultText(messages: readonly SDKMessage[], toolUseId: string): string {
  const message = messages[toolResultIndex(messages, toolUseId)];
  if (message?.type !== "user" || typeof message.message.content === "string") {
    return "";
  }
  return message.message.content
    .flatMap((block) => (block.type === "tool_result" && block.tool_use_id === toolUseId ? [block.content] : []))
    .flatMap((content) => (typeof content === "string" ? [content] : (content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : []))))
    .join("\n");
}

/** The tool's structured output for the call, such as Bash's `interrupted` flag; undefined when the engine sent none. */
export function toolUseResult(messages: readonly SDKMessage[], toolUseId: string): unknown {
  const message = messages[toolResultIndex(messages, toolUseId)];
  return message?.type === "user" ? message.tool_use_result : undefined;
}

/**
 * The engine's `permission_denied` message for the call, which it sends only for some refusals:
 * by its docs, not for hook denies or path-scoped deny rules on file tools.
 */
export function permissionDeniedMessage(messages: readonly SDKMessage[], toolUseId: string): SDKPermissionDeniedMessage | undefined {
  return messages.find(
    (message): message is SDKPermissionDeniedMessage =>
      message.type === "system" && message.subtype === "permission_denied" && message.tool_use_id === toolUseId,
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
