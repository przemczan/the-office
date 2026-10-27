import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  decisionListSchema,
  messageListSchema,
  proposalSchema,
  sizeThresholdSchema,
  threadListSchema,
  threadSchema,
  threadWebEventSchema,
  type ContextOverride,
  type DecisionAnswer,
  type Home,
  type Proposal,
  type ProposalApplication,
  type SizeThreshold,
  type Thread,
  type ThreadWebEvent,
  type TokenTotals,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventCacheUpdates, EventInvalidations } from "./event-stream-provider.tsx";
import { TASKS } from "./work.ts";

const THREADS = ["threads"] as const;
const DECISIONS = ["decisions"] as const;
const PROPOSALS = ["proposals"] as const;
const SIZE_THRESHOLD = ["settings", "size-threshold"] as const;

export const threadQueries = {
  /** The person's chat, the newest Thread first. */
  inChat: (roleKey: string) =>
    queryOptions({
      queryKey: [...THREADS, "chat", roleKey],
      queryFn: ({ signal }) =>
        getFromApi(`/chats/${encodeURIComponent(roleKey)}/threads`, threadListSchema, signal),
    }),
  /** The Threads on a Task, the newest first. */
  onTask: (taskId: string) =>
    queryOptions({
      queryKey: [...THREADS, "task", taskId],
      queryFn: ({ signal }) =>
        getFromApi(`/tasks/${encodeURIComponent(taskId)}/threads`, threadListSchema, signal),
    }),
  /** The person's Threads on every Task, the newest first. */
  onTasksWith: (roleKey: string) =>
    queryOptions({
      queryKey: [...THREADS, "on-tasks", roleKey],
      queryFn: ({ signal }) =>
        getFromApi(`/roles/${encodeURIComponent(roleKey)}/task-threads`, threadListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...THREADS, id],
      queryFn: ({ signal }) => getFromApi(threadPath(id), threadSchema, signal),
    }),
  /** The Office's log of the Thread, oldest first. */
  messages: (id: string) =>
    queryOptions({
      queryKey: [...THREADS, id, "messages"],
      queryFn: ({ signal }) => getFromApi(`${threadPath(id)}/messages`, messageListSchema, signal),
    }),
};

/** Settings › Office limits: the Context policy's size threshold, in tokens. */
export const sizeThresholdQuery = () =>
  queryOptions({
    queryKey: SIZE_THRESHOLD,
    queryFn: ({ signal }) => getFromApi("/settings/size-threshold", sizeThresholdSchema, signal),
  });

export function changeSizeThreshold(sizeThreshold: number): Promise<SizeThreshold> {
  return sendToApi("PUT", "/settings/size-threshold", { sizeThreshold }, sizeThresholdSchema);
}

export const decisionQueries = {
  /** Every Decision waiting on the user, the first asked first: what Waiting on you is made of. */
  open: () =>
    queryOptions({
      queryKey: [...DECISIONS, "open"],
      queryFn: ({ signal }) => getFromApi("/decisions/open", decisionListSchema, signal),
    }),
};

export const proposalQueries = {
  one: (id: string) =>
    queryOptions({
      queryKey: [...PROPOSALS, id],
      queryFn: ({ signal }) => getFromApi(proposalPath(id), proposalSchema, signal),
    }),
};

/**
 * Applies the Proposal: as drafted, or a new Role on the card the user edited before hiring. A
 * refusal leaves it open.
 */
export function applyProposal(id: string, application: ProposalApplication): Promise<Proposal> {
  return sendToApi("POST", `${proposalPath(id)}/apply`, application, proposalSchema);
}

/** "Not now": the Proposal is declined, and nothing changes. */
export function declineProposal(id: string): Promise<Proposal> {
  return sendToApi("POST", `${proposalPath(id)}/decline`, {}, proposalSchema);
}

/** A fresh Thread in the person's chat. */
export function startChatThread(roleKey: string): Promise<Thread> {
  return sendToApi("POST", `/chats/${encodeURIComponent(roleKey)}/threads`, {}, threadSchema);
}

/** The person answers in the background; the answer comes into the log as it is written. */
export function sendMessage(id: string, text: string): Promise<Thread> {
  return sendToApi("POST", `${threadPath(id)}/messages`, { text }, threadSchema);
}

export function renameThread(id: string, title: string): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/title`, { title }, threadSchema);
}

/** "Start fresh" or "Continue anyway" for the next message; null goes back to the policy. */
export function chooseContextOverride(
  id: string,
  override: ContextOverride | null,
): Promise<Thread> {
  return sendToApi("PUT", `${threadPath(id)}/context-override`, { override }, threadSchema);
}

/** The person who asked takes the answer in their Thread, which this answers with. */
export function answerDecision(id: string, answer: DecisionAnswer): Promise<Thread> {
  return sendToApi("POST", `/decisions/${encodeURIComponent(id)}/answer`, answer, threadSchema);
}

/** The Conversations events that carry what changed, which `threadEventCacheUpdates` applies. */
type CarryingEventType = "thread.tokens-counted";

/**
 * Every other Conversations event makes the Threads stale: ["threads"] covers each home's list,
 * each Thread and its log. A Decision's events also make ["decisions"] stale, kept apart so the
 * many events of a turn don't refetch the open Decisions, and ["tasks"], as a waiting Decision is
 * one line of a Task's "Before Ready" checklist. A Proposal applied or declined makes ["proposals"]
 * stale, read by the hire page that edits one.
 */
export const threadEventInvalidations: Readonly<
  Record<Exclude<ThreadWebEvent["type"], CarryingEventType>, EventInvalidations[string]>
> = {
  "thread.started": () => [THREADS],
  "thread.renamed": () => [THREADS],
  "thread.messages-logged": () => [THREADS],
  "thread.turn-ended": () => [THREADS],
  "thread.delivery-marked": () => [THREADS],
  "thread.override-chosen": () => [THREADS],
  "thread.decision-opened": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-answered": () => [THREADS, DECISIONS, TASKS],
  "thread.decision-reopened": () => [THREADS, DECISIONS, TASKS],
  "thread.proposal-drafted": () => [THREADS],
  "thread.proposal-applied": () => [THREADS, PROPOSALS],
  "thread.proposal-declined": () => [THREADS, PROPOSALS],
  "context-policy.size-threshold-changed": () => [SIZE_THRESHOLD, THREADS],
};

/**
 * A running turn's tokens change just that Thread, wherever it is cached, and with it its Task's
 * total, refetching no log: a long turn counts many times.
 */
export const threadEventCacheUpdates: Readonly<
  Record<CarryingEventType, EventCacheUpdates[string]>
> = {
  "thread.tokens-counted": (event, queryClient) => {
    const counted = threadWebEventSchema.parse(event);
    if (counted.type !== "thread.tokens-counted") return;
    showTokens(queryClient, counted.threadId, counted.home, counted.tokens);
  },
};

function showTokens(
  queryClient: QueryClient,
  threadId: string,
  home: Home,
  tokens: TokenTotals,
): void {
  queryClient.setQueryData(
    threadQueries.one(threadId).queryKey,
    (thread) => thread && { ...thread, tokens },
  );
  // A list without the Thread stays as it is, so nothing showing it renders again.
  const inList = (threads: Thread[] | undefined): Thread[] | undefined =>
    threads?.some(({ id }) => id === threadId)
      ? threads.map((thread) => (thread.id === threadId ? { ...thread, tokens } : thread))
      : threads;
  const homeList =
    home.kind === "chat" ? threadQueries.inChat(home.roleKey) : threadQueries.onTask(home.taskId);
  queryClient.setQueryData(homeList.queryKey, inList);
  // Every person's list of their Threads on Tasks, since the event doesn't name whose it is.
  queryClient.setQueriesData<Thread[]>({ queryKey: [...THREADS, "on-tasks"] }, inList);
}

function threadPath(id: string): `/${string}` {
  return `/threads/${encodeURIComponent(id)}`;
}

function proposalPath(id: string): `/${string}` {
  return `/proposals/${encodeURIComponent(id)}`;
}
