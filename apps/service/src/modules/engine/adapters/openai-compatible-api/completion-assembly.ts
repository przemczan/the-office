import { randomUUID } from "node:crypto";
import type { TokenUsage } from "../../ports/session-events.js";
import type {
  AssistantMessage,
  CompletionChunk,
  CompletionUsage,
  ToolCall,
  ToolCallDelta,
} from "./chat-completions.js";

/** A streamed answer once it has ended. */
export interface Completion {
  readonly message: AssistantMessage;
  /** Why the model stopped (`stop`, `tool_calls`, `length`, …), when the server says. */
  readonly finishReason: string | undefined;
  /** The request's tokens, or undefined when the server didn't report them. */
  readonly usage: TokenUsage | undefined;
}

interface ToolCallInProgress {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Builds one answer from its chunks. A tool call arrives in pieces named by their `index`: the id
 * and name usually in the first, the arguments spread over all of them. Usage comes in the last
 * chunk (with no choices, under `stream_options.include_usage`), with the finish reason, or never.
 */
export class CompletionAssembly {
  private content = "";
  private readonly toolCalls = new Map<number, ToolCallInProgress>();
  private finishReason: string | undefined;
  private usage: TokenUsage | undefined;

  /** Adds a chunk and answers the text it brought, empty when it brought none. */
  add(chunk: CompletionChunk): string {
    if (chunk.usage) this.usage = tokenUsage(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) return "";
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    choice.delta?.tool_calls?.forEach((delta, position) => this.addToolCall(delta, position));
    const text = choice.delta?.content ?? "";
    this.content += text;
    return text;
  }

  completion(): Completion {
    const toolCalls = [...this.toolCalls.entries()]
      .toSorted(([first], [second]) => first - second)
      .map(([, call]): ToolCall => ({
        id: call.id === "" ? `call_${randomUUID()}` : call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    return {
      message: {
        role: "assistant",
        content: this.content === "" ? null : this.content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finishReason: this.finishReason,
      usage: this.usage,
    };
  }

  private addToolCall(delta: ToolCallDelta, position: number): void {
    const index = delta.index ?? position;
    const call = this.toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
    if (delta.id) call.id = delta.id;
    // Some servers repeat the name in every piece, so the first one names the call.
    if (delta.function?.name && call.name === "") call.name = delta.function.name;
    call.arguments += delta.function?.arguments ?? "";
    this.toolCalls.set(index, call);
  }
}

/** The API counts cached tokens within the prompt's; `TokenUsage` keeps its parts apart. */
function tokenUsage(usage: CompletionUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input: Math.max(usage.prompt_tokens - cacheRead, 0),
    output: usage.completion_tokens,
    cacheRead,
    cacheCreation: 0,
  };
}
