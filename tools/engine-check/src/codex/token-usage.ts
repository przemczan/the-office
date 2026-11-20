import type { TokenUsage } from "../recorded-session.ts";
import type { ThreadTokenUsageUpdatedNotification, TokenUsageBreakdown } from "./protocol.ts";

const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/**
 * Codex's counts in the check's terms: its input includes the cached input, which is counted as a
 * cache read instead, as the Claude routes count it; its output includes the reasoning.
 */
export function tokenUsage(breakdown: TokenUsageBreakdown): TokenUsage {
  return {
    input: breakdown.inputTokens - breakdown.cachedInputTokens,
    output: breakdown.outputTokens,
    cacheRead: breakdown.cachedInputTokens,
    cacheCreation: breakdown.cacheWriteInputTokens,
  };
}

/**
 * The tokens one process spent, summed over its threads: each thread's last `total` less what it held
 * before the process's first model call on it, so a resumed thread's earlier turns are not counted
 * again.
 */
export function tokensSpent(updates: readonly ThreadTokenUsageUpdatedNotification[]): TokenUsage {
  const byThread = new Map<string, { before: TokenUsage; latest: TokenUsage }>();
  for (const { threadId, tokenUsage: usage } of updates) {
    const latest = tokenUsage(usage.total);
    const known = byThread.get(threadId);
    byThread.set(threadId, {
      before: known?.before ?? subtract(latest, tokenUsage(usage.last)),
      latest,
    });
  }
  return [...byThread.values()].reduce(
    (total, { before, latest }) => add(total, subtract(latest, before)),
    NO_TOKENS,
  );
}

function add(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreation: a.cacheCreation + b.cacheCreation,
  };
}

function subtract(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input - b.input,
    output: a.output - b.output,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheCreation: a.cacheCreation - b.cacheCreation,
  };
}
