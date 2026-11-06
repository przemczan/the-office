import { QueryClient } from "@tanstack/react-query";
import type { Message, Thread, ThreadWebEvent, TokenTotals } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { threadEventCacheUpdates, threadQueries } from "./conversations.ts";

const TASK_ID = "f3c1b2a4-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const NO_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

function aStageThread(id: string, tokens: TokenTotals): Thread {
  return {
    id,
    home: { kind: "task", taskId: TASK_ID },
    roleKey: "developer",
    title: "Build · Ada",
    state: "answering",
    tokens,
    context: {
      move: "fresh",
      reason: "new-thread",
      cacheWarm: false,
      cacheWarmUntil: null,
      contextTokens: 0,
      briefTokens: null,
      alternatives: [],
      override: null,
    },
    startedAt: "2026-10-26T09:00:00.000Z",
    stageThread: true,
    consultation: null,
    changesAllowed: null,
    answered: null,
    lastMovedAt: null,
  };
}

const running = aStageThread("0b6e7c1a-2f3d-4e5a-8b9c-0d1e2f3a4b5c", {
  ...NO_TOKENS,
  input: 1000,
});
const ended = aStageThread("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", { ...NO_TOKENS, output: 500 });
const counted: TokenTotals = { input: 1000, output: 2400, cacheRead: 30_000, cacheCreation: 600 };

function aQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(threadQueries.one(running.id).queryKey, running);
  queryClient.setQueryData(threadQueries.onTask(TASK_ID).queryKey, [running, ended]);
  queryClient.setQueryData(threadQueries.onTasksWith("tester").queryKey, [ended]);
  queryClient.setQueryData(threadQueries.messages(running.id).queryKey, [] as Message[]);
  return queryClient;
}

/** The event as the web receives it, with its own fields. */
function tokensCounted(queryClient: QueryClient): void {
  const event: ThreadWebEvent = {
    type: "thread.tokens-counted",
    occurredAt: "2026-10-26T09:05:00.000Z",
    threadId: running.id,
    home: running.home,
    tokens: counted,
  };
  threadEventCacheUpdates["thread.tokens-counted"](event, queryClient);
}

describe("a running turn's tokens", () => {
  it("show on the Thread and in its home's list, which the Task's total adds up, at once", () => {
    const queryClient = aQueryClient();

    tokensCounted(queryClient);

    expect(queryClient.getQueryData(threadQueries.one(running.id).queryKey)?.tokens).toEqual(
      counted,
    );
    const onTask = queryClient.getQueryData(threadQueries.onTask(TASK_ID).queryKey);
    expect(onTask?.map(({ tokens }) => tokens)).toEqual([counted, ended.tokens]);
  });

  it("refetch nothing, and leave a list without the Thread as it was", () => {
    const queryClient = aQueryClient();
    const otherList = queryClient.getQueryData(threadQueries.onTasksWith("tester").queryKey);

    tokensCounted(queryClient);

    const stale = queryClient
      .getQueryCache()
      .findAll()
      .filter((query) => query.state.isInvalidated);
    expect(stale).toEqual([]);
    expect(queryClient.getQueryData(threadQueries.onTasksWith("tester").queryKey)).toBe(otherList);
  });
});
