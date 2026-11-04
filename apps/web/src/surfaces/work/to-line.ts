import type { Thread } from "@the-office/contracts";
import { takesMessages } from "../../shell/conversation/thread-writing.ts";
import { threadsInOrder } from "./timeline-words.ts";

/** Why the composer is gone from a record still going: only closed Stage Threads are left. */
export const NO_WRITABLE_THREAD_WORDS =
  "No Thread takes a message now: you write in a Stage's Thread while its Stage runs.";

/** The Thread the composer writes to, and what moves it. */
export interface ToLine {
  readonly threadId: string | undefined;
  /** The live Thread when it was last set: only a change of that takes the line back to live. */
  readonly liveThreadId: string | undefined;
  /** The Thread that stopped taking messages under the user's draft, which the user must be told. */
  readonly closedUnderDraft: string | undefined;
}

/** The Threads the user can write in, the newest last. A record that ended has none. */
export function writableThreads(
  threads: readonly Thread[],
  readOnlyReason: string | undefined,
): Thread[] {
  return readOnlyReason === undefined ? threadsInOrder(threads).filter(takesMessages) : [];
}

/**
 * The Thread the work is happening in: the running Stage's, else one with an open Decision, else
 * the newest. A closed Stage Thread can hold a Decision too, so this takes only writable Threads.
 */
export function liveThread(
  writable: readonly Thread[],
  holdingOpenDecision: ReadonlySet<string>,
): Thread | undefined {
  return (
    writable.findLast(({ stageThread }) => stageThread) ??
    writable.findLast(({ id }) => holdingOpenDecision.has(id)) ??
    writable.at(-1)
  );
}

/**
 * Where the record's work stands, whether or not it takes a message: a Stage Thread is closed at its
 * Decision or a Gate, yet that is where the Task is. An ended record's comes to its newest Stage's.
 */
export function workingThread(
  threads: readonly Thread[],
  writable: readonly Thread[],
  holdingOpenDecision: ReadonlySet<string>,
): Thread | undefined {
  const inOrder = threadsInOrder(threads);
  return (
    writable.findLast(({ stageThread, consultation }) => stageThread || consultation !== null) ??
    inOrder.findLast(({ id }) => holdingOpenDecision.has(id)) ??
    inOrder.findLast(({ stageThread }) => stageThread) ??
    inOrder.at(-1)
  );
}

/** The line on a Thread the user chose, by the To line or by following a link. */
export function toLinePicked(
  threadId: string | undefined,
  liveThreadId: string | undefined,
): ToLine {
  return { threadId, liveThreadId, closedUnderDraft: undefined };
}

/**
 * The line as it is now. It follows the live Thread, and a pick holds until the live Thread changes.
 * While the user has a draft nothing moves it, so what they type never changes hands unseen, unless
 * its Thread closes: then the line takes the live Thread and says so, or stays, closed, when no
 * Thread is left to take the draft. An unchanged line comes back as it was.
 */
export function toLineNow(
  line: ToLine | undefined,
  writableIds: readonly string[],
  liveThreadId: string | undefined,
  drafting: boolean,
): ToLine {
  const onLive = toLinePicked(liveThreadId, liveThreadId);
  if (line === undefined) return onLive;
  if (line.threadId === undefined || !writableIds.includes(line.threadId)) {
    if (line.threadId === liveThreadId) return line;
    if (!drafting) return onLive;
    return liveThreadId === undefined ? line : { ...onLive, closedUnderDraft: line.threadId };
  }
  if (drafting) return line;
  if (liveThreadId !== line.liveThreadId) return onLive;
  return line.closedUnderDraft === undefined ? line : { ...line, closedUnderDraft: undefined };
}
