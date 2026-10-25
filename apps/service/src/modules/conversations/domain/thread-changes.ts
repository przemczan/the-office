import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { MessagesLogged, ThreadRenamed, ThreadStarted } from "./conversation-events.js";
import type { Message } from "./message.js";
import { NO_TOKENS, type Thread } from "./thread.js";
import { ThreadRefused } from "./thread-refused.js";
import { titleFrom, titleProblems } from "./thread-title.js";

/** A Thread after a change, with the messages it logged and the event that announces it. */
export interface ThreadChange<Event extends DomainEvent> {
  readonly thread: Thread;
  readonly logged: readonly Message[];
  readonly event: Event;
}

/** The person a chat is with, as their Role card has them. */
export interface ChatPerson {
  readonly roleKey: string;
  readonly name: string;
  /** Whether the card's Chat capability is on. */
  readonly chat: boolean;
}

/**
 * A fresh Thread in the person's chat: a new session underneath once they answer, with no context
 * from the Threads before it. Refused when the person's Chat is off.
 */
export function startChatThread(
  id: string,
  person: ChatPerson,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  if (!person.chat) {
    throw new ThreadRefused([
      `Chat is off for ${person.name}: talk to them on a Task, or turn Chat on on their Role card.`,
    ]);
  }
  const thread: Thread = {
    id,
    home: { kind: "chat", roleKey: person.roleKey },
    roleKey: person.roleKey,
    title: undefined,
    state: "waiting",
    session: undefined,
    tokens: NO_TOKENS,
    startedAt,
  };
  return { thread, event: new ThreadStarted(thread) };
}

/** Refuses with every reason; undefined when the title is the Thread's already. */
export function renameThread(
  thread: Thread,
  title: string,
  renamedAt: Date,
): ThreadChange<ThreadRenamed> | undefined {
  const problems = titleProblems(title);
  if (problems.length > 0) throw new ThreadRefused(problems);
  const trimmed = title.trim();
  if (trimmed === thread.title) return undefined;
  const renamed = { ...thread, title: trimmed };
  return { thread: renamed, logged: [], event: new ThreadRenamed(renamed, renamedAt) };
}

/**
 * Adds `messages` to the Thread's log, in order. An untitled Thread takes its title from the
 * user's first message; a title the user gave stays. Undefined when there is nothing to log.
 */
export function logMessages(
  thread: Thread,
  messages: readonly Message[],
  loggedAt: Date,
): ThreadChange<MessagesLogged> | undefined {
  if (messages.length === 0) return undefined;
  const stray = messages.find((message) => message.threadId !== thread.id);
  if (stray) throw new Error(`Message ${stray.id} belongs to Thread ${stray.threadId}.`);
  const titled = { ...thread, title: thread.title ?? titleOf(messages) };
  return {
    thread: titled,
    logged: messages,
    event: new MessagesLogged(titled, messages, loggedAt),
  };
}

function titleOf(messages: readonly Message[]): string | undefined {
  const first = messages.find((message) => message.kind === "user");
  const title = first && titleFrom(first.text);
  return title === "" ? undefined : title;
}
