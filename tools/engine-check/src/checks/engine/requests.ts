import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

/** One model request of the main conversation, with the token counts the API reported for it. */
export interface RequestUsage {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly cacheCreation1h: number;
  readonly cacheCreation5m: number;
}

/**
 * The main conversation's model requests, in order. The engine streams one assistant message per
 * content block, each repeating its request's usage, so a request is counted once by message id;
 * a subagent's requests are left out.
 */
export function requestUsages(messages: readonly SDKMessage[]): RequestUsage[] {
  const requests = new Map<string, RequestUsage>();
  for (const message of messages) {
    if (
      message.type !== "assistant" ||
      message.parent_tool_use_id !== null ||
      requests.has(message.message.id)
    ) {
      continue;
    }
    const { usage } = message.message;
    requests.set(message.message.id, {
      input: usage.input_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheCreation: usage.cache_creation_input_tokens ?? 0,
      cacheCreation1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      cacheCreation5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    });
  }
  return [...requests.values()];
}

/** The messages of each turn, each ending with the turn's result; a turn still running is left out. */
export function turns(messages: readonly SDKMessage[]): SDKMessage[][] {
  const completed: SDKMessage[][] = [];
  let current: SDKMessage[] = [];
  for (const message of messages) {
    current.push(message);
    if (message.type === "result") {
      completed.push(current);
      current = [];
    }
  }
  return completed;
}

/** The whole prompt of a request: what the API read from cache, wrote to it and took uncached. */
export function promptTokens(request: RequestUsage): number {
  return request.input + request.cacheRead + request.cacheCreation;
}

/**
 * Whether `later` read all of `earlier`'s prompt from the cache. A request caches its prompt up to
 * the last message, so a warm cache serves the next request at least that much; a cold one serves
 * only the system prompt and tools shared by every session with the same options.
 */
export function readsEarlierPromptFromCache(earlier: RequestUsage, later: RequestUsage): boolean {
  return later.cacheRead >= earlier.cacheRead + earlier.cacheCreation;
}

/** The cache lifetimes the requests wrote with, as `1h` and `5m`. */
export function cacheWriteLifetimes(requests: readonly RequestUsage[]): string[] {
  return [
    ...(requests.some((request) => request.cacheCreation1h > 0) ? ["1h"] : []),
    ...(requests.some((request) => request.cacheCreation5m > 0) ? ["5m"] : []),
  ];
}

/** The uuids of the messages a turn consumed, those folded in between tool calls included. */
export function consumedMessages(result: SDKResultMessage): readonly string[] {
  return result.user_message_uuids ?? [];
}

/** A token count rounded to the nearest 10k, so a count that holds run to run can be recorded. */
export function roundedTokens(tokens: number): string {
  return `about ${Math.round(tokens / 10_000) * 10}k`;
}
