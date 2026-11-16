import { z } from "zod";

/**
 * The OpenAI-compatible API's chat completions, as this adapter sends and reads them: the wire
 * shapes, kept as they are so the conversation can be sent back and kept unchanged.
 */

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    /** JSON as the model wrote it, which may not parse. */
    readonly arguments: string;
  };
}

export interface SystemMessage {
  readonly role: "system";
  readonly content: string;
}

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

/** An image the model sees, its `url` a `data:<media type>;base64,<bytes>` URL. */
export interface ImagePart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

export type UserContentPart = TextPart | ImagePart;

/** A user message's content: its text, or its parts when it carries images the model sees. */
export interface UserMessage {
  readonly role: "user";
  readonly content: string | readonly UserContentPart[];
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
}

export interface ToolMessage {
  readonly role: "tool";
  readonly tool_call_id: string;
  readonly content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface ToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    /** The input's JSON Schema. */
    readonly parameters: Record<string, unknown>;
  };
}

/** What one request asks; the client adds the streaming fields. */
export interface ChatCompletionsRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
}

const toolCallDeltaSchema = z.object({
  index: z.number().int().nonnegative().nullish(),
  id: z.string().nullish(),
  function: z
    .object({
      name: z.string().nullish(),
      arguments: z.string().nullish(),
    })
    .nullish(),
});

export type ToolCallDelta = z.infer<typeof toolCallDeltaSchema>;

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  prompt_tokens_details: z
    .object({ cached_tokens: z.number().int().nonnegative().nullish() })
    .nullish(),
});

export type CompletionUsage = z.infer<typeof usageSchema>;

/** One streamed chunk. Servers differ in what they leave out, so nearly everything may be missing. */
export const completionChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            tool_calls: z.array(toolCallDeltaSchema).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: usageSchema.nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

export type CompletionChunk = z.infer<typeof completionChunkSchema>;

/** The data that ends a stream instead of a chunk. */
export const STREAM_DONE = "[DONE]";
