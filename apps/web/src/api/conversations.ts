import { queryOptions } from "@tanstack/react-query";
import {
  messageListSchema,
  threadListSchema,
  threadSchema,
  type ContextOverride,
  type Thread,
  type ThreadWebEvent,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const THREADS = ["threads"] as const;

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

/**
 * Every Conversations event makes the Threads stale: ["threads"] covers each home's list, each
 * Thread and its log.
 */
export const threadEventInvalidations: Readonly<
  Record<ThreadWebEvent["type"], EventInvalidations[string]>
> = {
  "thread.started": () => [THREADS],
  "thread.renamed": () => [THREADS],
  "thread.messages-logged": () => [THREADS],
  "thread.turn-ended": () => [THREADS],
  "thread.override-chosen": () => [THREADS],
};

function threadPath(id: string): `/${string}` {
  return `/threads/${encodeURIComponent(id)}`;
}
