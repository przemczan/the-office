import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { ContextDecision } from "./context-policy.js";
import {
  answerProblems,
  decisionProblems,
  type Decision,
  type DecisionAnswer,
  type DecisionDraft,
} from "./decision.js";
import {
  ContextOverrideChosen,
  DecisionAnswered,
  DecisionOpened,
  DecisionReopened,
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
  /** A Decision the change opened or answered, saved with the Thread. */
  readonly decision?: Decision;
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
    openDecision: undefined,
  };
  return { thread, event: new ThreadStarted(thread) };
}

/** Where a Thread on a Task is, who answers in it, and what it is called. */
export interface TaskThreadStart {
  readonly taskId: string;
  readonly roleKey: string;
  readonly title: string;
}

/**
 * A Thread on a Task, such as its planning Thread, titled by The Office: its first message is The
 * Office's opening, not the user's.
 */
export function startTaskThread(
  id: string,
  { taskId, roleKey, title }: TaskThreadStart,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  const problems = titleProblems(title);
  if (problems.length > 0) throw new ThreadRefused(problems);
  const thread: Thread = {
    id,
    home: { kind: "task", taskId },
    roleKey,
    title: title.trim(),
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: NO_TOKENS,
    startedAt,
    openDecision: undefined,
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
export interface Answering extends Opening {
  /** The user's message, of kind `user`. */
  readonly said: Message;
}

/** The person starts on a Thread under the Context policy's move. */
export interface Opening {
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
export function beginAnswer(thread: Thread, answering: Answering): ThreadChange<MessagesLogged> {
  const { said, decision } = answering;
  return begin(thread, answering, [...movedLines(thread, decision, said.at), said], said.at);
}

/** A Decision the person opens in the Thread they work in, and when. */
export interface DecisionOpening extends DecisionDraft {
  readonly id: string;
  readonly askedAt: Date;
}

/**
 * The person opens a Decision (spec §2.4): its card is logged, and the Thread waits on it until the
 * user answers. Refused in a chat, which only talks, while another Decision waits, and with every
 * problem of what is asked, in words the person acts on.
 */
export function openDecision(
  thread: Thread,
  { id, askedAt, ...draft }: DecisionOpening,
): ThreadChange<DecisionOpened> {
  if (thread.home.kind !== "task") {
    throw new ThreadRefused([
      "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    ]);
  }
  if (thread.openDecision) {
    throw new ThreadRefused([
      `Your Decision "${thread.openDecision.question}" still waits on the user. End your turn: their answer comes as your next message.`,
    ]);
  }
  const problems = decisionProblems(draft);
  if (problems.length > 0) throw new ThreadRefused(problems);
  const decision: Decision = {
    ...draft,
    id,
    threadId: thread.id,
    taskId: thread.home.taskId,
    roleKey: thread.session?.roleKey ?? thread.roleKey,
    askedAt,
    answer: undefined,
  };
  const card: Message = {
    kind: "decision",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: askedAt,
    roleKey: decision.roleKey,
    decisionId: id,
  };
  const waiting: Thread = { ...thread, openDecision: decision };
  return {
    thread: waiting,
    logged: [card],
    decision,
    event: new DecisionOpened(waiting, decision),
  };
}

/** The user's answer to the Thread's open Decision, as the person takes it under the move. */
export interface DecisionAnswering extends Opening {
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  /** The id of the answer's line in the log, which the session is sent it by. */
  readonly messageId: string;
  readonly answeredAt: Date;
}

/**
 * The user answers the Thread's open Decision: the answer is logged, with the move when it wasn't
 * simply continuing a warm session, the Decision is answered, and the person takes the answer as
 * their next message. Refused once it is answered, with an answer that isn't one, and while the
 * person is still answering.
 */
export function answerDecision(
  thread: Thread,
  answering: DecisionAnswering,
): ThreadChange<DecisionAnswered> {
  const { decisionId, answer, messageId, answeredAt } = answering;
  const open = thread.openDecision;
  if (open?.id !== decisionId) throw new ThreadRefused(["This Decision is answered already."]);
  const problems = answerProblems(open, answer);
  if (problems.length > 0) throw new ThreadRefused(problems);
  if (thread.state === "answering") {
    throw new ThreadRefused([
      `${answering.personName} is still answering. Answer once they finish.`,
    ]);
  }
  const decision: Decision = { ...open, answer: { ...answer, answeredAt } };
  const line: Message = {
    kind: "decision-answer",
    id: messageId,
    threadId: thread.id,
    at: answeredAt,
    decisionId,
    answer,
  };
  const moved = movedLines(thread, answering.decision, answeredAt);
  const begun = begin(
    { ...thread, openDecision: undefined },
    answering,
    [...moved, line],
    answeredAt,
  );
  return {
    thread: begun.thread,
    logged: begun.logged,
    decision,
    event: new DecisionAnswered(begun.thread, decision, answeredAt),
  };
}

/** The move's line, unless it was simply continuing a warm session. */
function movedLines(thread: Thread, decision: ContextDecision, at: Date): Message[] {
  return decision.reason === "cache-warm" ? [] : [contextLineOf(thread, decision, at)];
}

/**
 * The person starts on a Thread The Office opened, before the user says anything: its first
 * session's move is logged, and the Thread is answering.
 */
export function beginOpening(
  thread: Thread,
  opening: Opening,
  openedAt: Date,
): ThreadChange<MessagesLogged> {
  if (thread.session) throw new Error(`Thread ${thread.id} is open already.`);
  return begin(thread, opening, [contextLineOf(thread, opening.decision, openedAt)], openedAt);
}

function begin(
  thread: Thread,
  { personName, newSession }: Opening,
  messages: readonly Message[],
  at: Date,
): ThreadChange<MessagesLogged> {
  if (thread.state === "answering") {
    throw new ThreadRefused([`${personName} is still answering. Send it once they finish.`]);
  }
  const answering: Thread = {
    ...thread,
    state: "answering",
    override: undefined,
    session: newSession ?? thread.session,
  };
  const logged = logMessages(answering, messages, at);
  if (!logged) throw new Error("Starting an answer always logs a message.");
  return logged;
}

function contextLineOf(thread: Thread, decision: ContextDecision, at: Date): Message {
  return {
    kind: "context",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at,
    move: decision.move,
    reason: decision.reason,
    contextTokens: decision.contextTokens,
    briefTokens: decision.briefTokens,
  };
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
      startContextTokens: thread.session.startContextTokens ?? contextTokens,
      full: thread.session.full || handingOver,
    },
  };
  return { thread: ended, logged: [], event: new TurnEnded(ended, endedAt) };
}

/** A session the move started that never opened, and the one the Thread had before it. */
export interface UnopenedSession {
  readonly sessionId: string;
  readonly previous: ThreadSession | undefined;
}

/**
 * The person couldn't answer: why is logged, and the Thread waits for the user again. A session
 * that never opened gives way to the one the Thread had before, so the next message isn't read
 * as continuing a session that never ran.
 */
export function failAnswer(
  thread: Thread,
  reason: string,
  failedAt: Date,
  unopened?: UnopenedSession,
): ThreadChange<MessagesLogged> {
  const failure: Message = {
    kind: "failure",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: failedAt,
    reason,
  };
  const session =
    unopened && thread.session?.id === unopened.sessionId ? unopened.previous : thread.session;
  const waiting: Thread = { ...thread, state: "waiting", session };
  return {
    thread: waiting,
    logged: [failure],
    event: new MessagesLogged(waiting, [failure], failedAt),
  };
}

/**
 * The person couldn't take the user's answer to `decision`: the session it went to never started,
 * so the answer reached nobody. As `failAnswer`, why is logged and the Thread waits; the Decision
 * waits on the user again, its answer cleared, so it can be answered anew.
 */
export function failDecisionAnswer(
  thread: Thread,
  decision: Decision,
  reason: string,
  failedAt: Date,
  unopened?: UnopenedSession,
): ThreadChange<DecisionReopened> {
  if (thread.openDecision) {
    throw new Error(`Thread ${thread.id} has the Decision ${thread.openDecision.id} open already.`);
  }
  const failed = failAnswer(thread, reason, failedAt, unopened);
  const reopened: Decision = { ...decision, answer: undefined };
  const waiting: Thread = { ...failed.thread, openDecision: reopened };
  return {
    thread: waiting,
    logged: failed.logged,
    decision: reopened,
    event: new DecisionReopened(waiting, reopened, failedAt),
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
