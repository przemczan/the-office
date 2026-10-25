import { queryOptions } from "@tanstack/react-query";
import {
  decisionListSchema,
  messageListSchema,
  threadListSchema,
  threadSchema,
  type ContextOverride,
  type DecisionAnswer,
  type Thread,
  type ThreadWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const THREADS = ["threads"] as const;
const DECISIONS = ["decisions"] as const;

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

export const decisionQueries = {
  /** Every Decision waiting on the user, the first asked first: what Waiting on you is made of. */
  open: () =>
    queryOptions({
      queryKey: [...DECISIONS, "open"],
      queryFn: ({ signal }) => getFromApi("/decisions/open", decisionListSchema, signal),
    }),
};

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

/**
 * Every Conversations event makes the Threads stale: ["threads"] covers each home's list, each
 * Thread and its log. A Decision's events also make ["decisions"] stale, kept apart so the many
 * events of a turn don't refetch the open Decisions.
 */
export const threadEventInvalidations: Readonly<
  Record<ThreadWebEvent["type"], EventInvalidations[string]>
> = {
  "thread.started": () => [THREADS],
  "thread.renamed": () => [THREADS],
  "thread.messages-logged": () => [THREADS],
  "thread.turn-ended": () => [THREADS],
  "thread.override-chosen": () => [THREADS],
  "thread.decision-opened": () => [THREADS, DECISIONS],
  "thread.decision-answered": () => [THREADS, DECISIONS],
};

function threadPath(id: string): `/${string}` {
  return `/threads/${encodeURIComponent(id)}`;
}
