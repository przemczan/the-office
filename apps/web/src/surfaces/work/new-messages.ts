import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { Message } from "@the-office/contracts";
import { useState } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { useDetails } from "../../shell/conversation/details-store.ts";
import { visibleMessages } from "../../shell/conversation/message-visibility.ts";

/** What landed out of the reader's view. */
export interface NewMessages {
  readonly count: number;
  /** The Thread the newest of them landed in, while there are any. */
  readonly threadId: string | undefined;
  /** The messages already there, by Thread, as what is new goes by id: Details changes the length. */
  readonly known: ReadonlyMap<string, ReadonlySet<string>>;
}

export const NO_NEW_MESSAGES: NewMessages = { count: 0, threadId: undefined, known: new Map() };

/** A Thread's log as it stands; `messages` is undefined until it has loaded. */
export interface WatchedLog {
  readonly threadId: string;
  readonly messages: readonly Message[] | undefined;
  /** What lands in it comes into view by itself. */
  readonly inView: boolean;
}

/**
 * Counts what landed since last time among what shows, in the Threads that are out of view. What a
 * Thread already holds when it starts being watched is not new. An unchanged state comes back as it
 * was.
 */
export function withArrivals(
  before: NewMessages,
  logs: readonly WatchedLog[],
  details: boolean,
): NewMessages {
  const known = new Map<string, ReadonlySet<string>>();
  let { count, threadId } = before;
  let changed = false;
  for (const log of logs) {
    if (log.messages === undefined) continue;
    const knownIds = before.known.get(log.threadId);
    const arrived = log.messages.filter(({ id }) => knownIds?.has(id) === false);
    if (knownIds !== undefined && arrived.length === 0) {
      known.set(log.threadId, knownIds);
      continue;
    }
    changed = true;
    known.set(log.threadId, new Set(log.messages.map(({ id }) => id)));
    const shown = visibleMessages(arrived, details).length;
    if (shown > 0 && !log.inView) {
      count += shown;
      threadId = log.threadId;
    }
  }
  return changed || known.size !== before.known.size ? { count, threadId, known } : before;
}

/** The count goes once the Thread the newest landed in is in view. */
export function withNewMessagesRead(
  now: NewMessages,
  inView: (threadId: string) => boolean,
): NewMessages {
  return now.threadId !== undefined && inView(now.threadId)
    ? { ...now, count: 0, threadId: undefined }
    : now;
}

/** What landed out of view in each Thread on its own, as a tab counts only its Thread's. */
export type NewMessagesByThread = ReadonlyMap<string, NewMessages>;

/** As `withArrivals` and `withNewMessagesRead`, each Thread apart: reading one leaves the others. */
export function withArrivalsByThread(
  before: NewMessagesByThread,
  logs: readonly WatchedLog[],
  details: boolean,
): NewMessagesByThread {
  const after = new Map<string, NewMessages>();
  for (const log of logs) {
    const was = before.get(log.threadId) ?? NO_NEW_MESSAGES;
    const landed = withArrivals(was, [log], details);
    after.set(
      log.threadId,
      withNewMessagesRead(landed, () => log.inView),
    );
  }
  const unchanged =
    after.size === before.size &&
    [...after].every(([threadId, now]) => before.get(threadId) === now);
  return unchanged ? before : after;
}

export function newMessagesWords(count: number): string {
  return `${count} new ${count === 1 ? "message" : "messages"}`;
}

/**
 * What landed out of view in each of the Threads, watching their logs here and not in their
 * chapters, as a folded chapter's messages count too. The queries are the chapters' own, so nothing
 * is read twice.
 */
export function useNewMessagesByThread(
  threadIds: readonly string[],
  inView: (threadId: string) => boolean,
): NewMessagesByThread {
  const details = useDetails().on;
  const watchedLogs = useWatchedLogs(threadIds, inView);
  const [before, setBefore] = useState<NewMessagesByThread>(new Map());
  const now = withArrivalsByThread(before, watchedLogs, details);
  if (now !== before) setBefore(now);
  return now;
}

function useWatchedLogs(
  threadIds: readonly string[],
  inView: (threadId: string) => boolean,
): readonly WatchedLog[] {
  const watched = [...new Set(threadIds)];
  const logs = useQueries({
    queries: watched.map((threadId) => threadQueries.messages(threadId)),
    combine: dataOfEach,
  });
  return watched.map((threadId, index) => ({
    threadId,
    messages: logs[index],
    inView: inView(threadId),
  }));
}

function dataOfEach(
  results: readonly UseQueryResult<readonly Message[]>[],
): (readonly Message[] | undefined)[] {
  return results.map(({ data }) => data);
}
