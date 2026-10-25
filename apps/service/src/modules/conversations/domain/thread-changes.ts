import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { ContextDecision } from "./context-policy.js";
import {
  ContextOverrideChosen,
  MessagesLogged,
  ThreadRenamed,
  ThreadStarted,
  TurnEnded,
} from "./conversation-events.js";
import type { Message } from "./message.js";
import {
  NO_TOKENS,
  type ContextOverride,
  type Thread,
  type ThreadSession,
  type TokenTotals,
} from "./thread.js";
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
    override: undefined,
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

/** The user's message, as the person takes it under the Context policy's move. */
export interface Answering {
  /** The user's message, of kind `user`. */
  readonly said: Message;
  readonly personName: string;
  readonly decision: ContextDecision;
  /** The session the move opens; undefined when it resumes the Thread's own. */
  readonly newSession: ThreadSession | undefined;
}

/**
 * The person takes the user's message: it is logged, with the move when it wasn't simply
 * continuing a warm session, and the Thread is answering. The moment's override is spent. Refused
 * while the person is still answering: a chat has no barge-in.
 */
export function beginAnswer(
  thread: Thread,
  { said, personName, decision, newSession }: Answering,
): ThreadChange<MessagesLogged> {
  if (thread.state === "answering") {
    throw new ThreadRefused([`${personName} is still answering. Send it once they finish.`]);
  }
  const contextLine: Message[] =
    decision.reason === "cache-warm"
      ? []
      : [
          {
            kind: "context",
            id: crypto.randomUUID(),
            threadId: thread.id,
            at: said.at,
            move: decision.move,
            reason: decision.reason,
            contextTokens: decision.contextTokens,
            briefTokens: decision.briefTokens,
          },
        ];
  const answering: Thread = {
    ...thread,
    state: "answering",
    override: undefined,
    session: newSession ?? thread.session,
  };
  const logged = logMessages(answering, [...contextLine, said], said.at);
  if (!logged) throw new Error("The user's message is always logged.");
  return logged;
}

/** How a turn of the person's ended, as the engine counted it. */
export interface TurnCount {
  readonly usage: TokenTotals;
  /** The session's context after the turn. */
  readonly contextTokens: number;
  /** The context neared its limit, so The Office asks for a Handover note next. */
  readonly handingOver: boolean;
  readonly endedAt: Date;
}

/**
 * Counts the turn's tokens on the Thread and its session's context. The Thread waits for the
 * user again, unless the person writes a Handover note next.
 */
export function endTurn(
  thread: Thread,
  { usage, contextTokens, handingOver, endedAt }: TurnCount,
): ThreadChange<TurnEnded> {
  if (!thread.session) throw new Error(`Thread ${thread.id} has no session to end a turn of.`);
  const ended: Thread = {
    ...thread,
    state: handingOver ? "answering" : "waiting",
    tokens: addTokens(thread.tokens, usage),
    session: {
      ...thread.session,
      lastCallAt: endedAt,
      contextTokens,
      full: thread.session.full || handingOver,
    },
  };
  return { thread: ended, logged: [], event: new TurnEnded(ended, endedAt) };
}

/** The person couldn't answer: why is logged, and the Thread waits for the user again. */
export function failAnswer(
  thread: Thread,
  reason: string,
  failedAt: Date,
): ThreadChange<MessagesLogged> {
  const failure: Message = {
    kind: "failure",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: failedAt,
    reason,
  };
  const waiting: Thread = { ...thread, state: "waiting" };
  return {
    thread: waiting,
    logged: [failure],
    event: new MessagesLogged(waiting, [failure], failedAt),
  };
}

/** "Start fresh" or "Continue anyway" for the next message; undefined goes back to the policy. */
export function chooseOverride(
  thread: Thread,
  override: ContextOverride | undefined,
  chosenAt: Date,
): ThreadChange<ContextOverrideChosen> | undefined {
  if (override === thread.override) return undefined;
  const chosen: Thread = { ...thread, override };
  return { thread: chosen, logged: [], event: new ContextOverrideChosen(chosen, chosenAt) };
}

function addTokens(total: TokenTotals, turn: TokenTotals): TokenTotals {
  return {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cacheRead: total.cacheRead + turn.cacheRead,
    cacheCreation: total.cacheCreation + turn.cacheCreation,
  };
}
