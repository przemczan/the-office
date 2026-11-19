import { QueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import type {
  Message,
  TaskThreadPage,
  Thread,
  ThreadWebEvent,
  TokenTotals,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  threadEventCacheUpdates,
  threadEventInvalidations,
  threadQueries,
} from "./conversations.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { PERSON_TASKS, TASKS } from "./work.ts";

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
      contextWindow: null,
      contextReported: true,
      briefTokens: null,
      alternatives: [],
      override: null,
    },
    startedAt: "2026-10-26T09:00:00.000Z",
    stageThread: true,
    consultation: null,
    changesAllowed: null,
    skillCommands: [],
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

/** The person's Threads on Tasks as their first page reads them. */
function onTasksPage(...threads: readonly Thread[]): InfiniteData<TaskThreadPage> {
  const rows = threads.map(({ id, home, roleKey, title, state, tokens, startedAt, context }) => ({
    id,
    home,
    roleKey,
    title,
    state,
    tokens,
    startedAt,
    consultation: null,
    answered: null,
    lastMovedAt: null,
    context: {
      move: context.move,
      reason: context.reason,
      cacheWarm: context.cacheWarm,
      cacheWarmUntil: context.cacheWarmUntil,
      contextTokens: context.contextTokens,
    },
    task: { id: TASK_ID, title: "Build the export", projectId: "admin-panel" },
  }));
  return { pages: [{ rows, next: null, total: rows.length }], pageParams: [undefined] };
}

function aQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(threadQueries.one(running.id).queryKey, running);
  queryClient.setQueryData(threadQueries.onTask(TASK_ID).queryKey, [running, ended]);
  queryClient.setQueryData(threadQueries.onTasksWith("tester").queryKey, onTasksPage(ended));
  queryClient.setQueryData(threadQueries.onTasksWith("developer").queryKey, onTasksPage(running));
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
    const theirs = queryClient.getQueryData(threadQueries.onTasksWith("developer").queryKey);
    expect(theirs?.pages[0]?.rows.map(({ tokens }) => tokens)).toEqual([counted]);
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

describe("a running turn's context reading", () => {
  it("moves the Thread's reading at once, refetching nothing", () => {
    const queryClient = aQueryClient();
    const event: ThreadWebEvent = {
      type: "thread.context-read",
      occurredAt: "2026-10-26T09:05:00.000Z",
      threadId: running.id,
      home: running.home,
      contextTokens: 118_000,
      contextWindow: 200_000,
    };

    threadEventCacheUpdates["thread.context-read"](event, queryClient);

    expect(queryClient.getQueryData(threadQueries.one(running.id).queryKey)?.context).toMatchObject(
      { contextTokens: 118_000, contextWindow: 200_000, reason: "new-thread" },
    );
    const stale = queryClient
      .getQueryCache()
      .findAll()
      .filter((query) => query.state.isInvalidated);
    expect(stale).toEqual([]);
  });
});

const OTHER_TASK_ID = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
const INITIATIVE_ID = "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918";
const CHAT_THREAD_ID = "5c4b3a29-1807-4f6e-9d5c-4b3a29180706";
const INITIATIVE_THREAD_ID = "3a291807-0605-4e4d-8c3b-2a1908070605";

/** Each kind of Threads query an open tab may hold, by what it shows. */
const cached = {
  thread: threadQueries.one(running.id).queryKey,
  messages: threadQueries.messages(running.id).queryKey,
  subAgentsAndProcesses: threadQueries.subAgentsAndProcesses(running.id).queryKey,
  otherThread: threadQueries.one(ended.id).queryKey,
  chatThread: threadQueries.one(CHAT_THREAD_ID).queryKey,
  initiativeThread: threadQueries.one(INITIATIVE_THREAD_ID).queryKey,
  taskThreads: threadQueries.onTask(TASK_ID).queryKey,
  taskConversation: threadQueries.conversationOnTask(TASK_ID).queryKey,
  otherTaskThreads: threadQueries.onTask(OTHER_TASK_ID).queryKey,
  otherTaskConversation: threadQueries.conversationOnTask(OTHER_TASK_ID).queryKey,
  developersTaskThreads: threadQueries.onTasksWith("developer").queryKey,
  testersTaskThreads: threadQueries.onTasksWith("tester").queryKey,
  developersChat: threadQueries.inChat("developer").queryKey,
  testersChat: threadQueries.inChat("tester").queryKey,
  chatActivity: threadQueries.chatActivity().queryKey,
  peopleWorking: threadQueries.peopleWorking().queryKey,
  initiativeThreads: threadQueries.onInitiative(INITIATIVE_ID).queryKey,
  personTasks: PERSON_TASKS,
  tasks: TASKS,
} as const satisfies Record<string, QueryKey>;
type Cached = keyof typeof cached;

/** Which of `cached` the event makes stale, as the event stream invalidates each key it names. */
async function staleAfter(event: ThreadWebEvent): Promise<Cached[]> {
  const queryClient = new QueryClient();
  for (const queryKey of Object.values(cached)) {
    queryClient.setQueryData<unknown>(queryKey as QueryKey, {});
  }
  const invalidations = threadEventInvalidations as EventInvalidations;
  const keys = invalidations[event.type]?.(event) ?? [];
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  return (Object.keys(cached) as Cached[]).filter(
    (name) => queryClient.getQueryState(cached[name] as QueryKey)?.isInvalidated,
  );
}

const AT = "2026-10-26T09:05:00.000Z";

describe("a Thread's event", () => {
  it("on a Task refreshes that Thread, its Task's lists and who works, never another Task or a chat", async () => {
    const stale = await staleAfter({
      type: "thread.messages-logged",
      occurredAt: AT,
      threadId: running.id,
      home: running.home,
    });

    expect(stale.toSorted()).toEqual(
      (
        [
          "thread",
          "messages",
          "subAgentsAndProcesses",
          "taskThreads",
          "taskConversation",
          "developersTaskThreads",
          "testersTaskThreads",
          "peopleWorking",
        ] satisfies Cached[]
      ).toSorted(),
    );
  });

  it("seen in a chat refreshes that Thread, its person's chat and the chats' activity", async () => {
    const stale = await staleAfter({
      type: "thread.seen",
      occurredAt: AT,
      threadId: CHAT_THREAD_ID,
      home: { kind: "chat", roleKey: "developer" },
    });

    expect(stale.toSorted()).toEqual(
      (["chatThread", "developersChat", "chatActivity"] satisfies Cached[]).toSorted(),
    );
  });

  it("renaming a Task's Thread leaves who works as it was, and renames the person's Task", async () => {
    const stale = await staleAfter({
      type: "thread.renamed",
      occurredAt: AT,
      threadId: running.id,
      home: running.home,
    });

    expect(stale).toContain("personTasks");
    expect(stale).toContain("taskThreads");
    expect(stale).not.toContain("peopleWorking");
  });

  it("a Decision on an Initiative refreshes its Thread, its list, the Decisions and the Tasks only", async () => {
    const stale = await staleAfter({
      type: "thread.decision-opened",
      occurredAt: AT,
      threadId: INITIATIVE_THREAD_ID,
      home: { kind: "initiative", initiativeId: INITIATIVE_ID },
      decisionId: "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
    });

    expect(stale.toSorted()).toEqual(
      (
        ["initiativeThread", "initiativeThreads", "personTasks", "tasks"] satisfies Cached[]
      ).toSorted(),
    );
  });

  it("a Thread starting refreshes every Threads list, as it can change another home's tabs", async () => {
    const stale = await staleAfter({
      type: "thread.started",
      occurredAt: AT,
      threadId: INITIATIVE_THREAD_ID,
      home: { kind: "initiative", initiativeId: INITIATIVE_ID },
    });

    expect(stale).toContain("otherTaskConversation");
    expect(stale).toContain("chatActivity");
  });
});
