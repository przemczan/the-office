import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readsEarlierPromptFromCache, requestUsages, roundedTokens, type RequestUsage } from "./requests.ts";

function request(cacheRead: number, cacheCreation: number): RequestUsage {
  return { input: 2, cacheRead, cacheCreation, cacheCreation1h: cacheCreation, cacheCreation5m: 0 };
}

function assistant(id: string, cacheRead: number, parentToolUseId: string | null = null): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    message: { id, usage: { input_tokens: 2, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } },
  } as unknown as SDKMessage;
}

test("a warm cache serves the whole earlier prompt, a cold one only the shared prefix", () => {
  const earlier = request(24_640, 3_300);
  assert.equal(readsEarlierPromptFromCache(earlier, request(27_940, 100)), true);
  assert.equal(readsEarlierPromptFromCache(earlier, request(24_640, 3_400)), false);
});

test("counts each request once and leaves out a subagent's", () => {
  const messages = [assistant("a", 10), assistant("a", 10), assistant("sub", 99, "tool-1"), assistant("b", 20)];
  assert.deepEqual(
    requestUsages(messages).map((usage) => usage.cacheRead),
    [10, 20],
  );
});

test("rounds a token count to the nearest 10k", () => {
  assert.equal(roundedTokens(27_944), "about 30k");
  assert.equal(roundedTokens(14_999), "about 10k");
});
