import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadTokenUsageUpdatedNotification, TokenUsageBreakdown } from "./protocol.ts";
import { tokensSpent, tokenUsage } from "./token-usage.ts";

function breakdown(input: number, cached: number, output: number): TokenUsageBreakdown {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}

function update(
  threadId: string,
  total: TokenUsageBreakdown,
  last: TokenUsageBreakdown,
): ThreadTokenUsageUpdatedNotification {
  return {
    threadId,
    turnId: "turn",
    tokenUsage: { total, last, modelContextWindow: 400_000 },
  };
}

test("cached input counts as a cache read, not as input", () => {
  assert.deepEqual(tokenUsage(breakdown(1000, 800, 50)), {
    input: 200,
    output: 50,
    cacheRead: 800,
    cacheCreation: 0,
  });
});

test("a thread's tokens are its last total, less what it held before the process's first call", () => {
  // A resumed thread: 1000 in and 100 out before this process; two calls here.
  const updates = [
    update("t1", breakdown(1600, 400, 120), breakdown(600, 400, 20)),
    update("t1", breakdown(2300, 1000, 150), breakdown(700, 600, 30)),
  ];
  assert.deepEqual(tokensSpent(updates), {
    input: 300,
    output: 50,
    cacheRead: 1000,
    cacheCreation: 0,
  });
});

test("threads are summed", () => {
  const first = breakdown(100, 0, 10);
  const second = breakdown(200, 50, 20);
  assert.deepEqual(tokensSpent([update("a", first, first), update("b", second, second)]), {
    input: 250,
    output: 30,
    cacheRead: 50,
    cacheCreation: 0,
  });
});
