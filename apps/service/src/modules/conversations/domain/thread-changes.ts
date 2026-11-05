import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { isApproval } from "./consult.js";
import type { ContextDecision } from "./context-policy.js";
import {
  answerProblems,
  attachmentProblems,
  decisionProblems,
  type Decision,
  type DecisionAnswer,
  type DecisionDraft,
} from "./decision.js";
import {
  ContextOverrideChosen,
  DeliveryMarked,
  DecisionAnswered,
  DecisionOpened,
  DecisionReopened,
  MessagesLogged,
  ProposalDrafted,
  ThreadRenamed,
  ThreadStarted,
  TokensCounted,
  TurnEnded,
} from "./conversation-events.js";
import type { Message, MessageDelivery, MessageDraft, StageWorkClosing } from "./message.js";
import { proposedChangeProblems, type Proposal, type ProposedChange } from "./proposal.js";
import { ProposalRefused } from "./proposal-refused.js";
import {
  addTokens,
  NO_TOKENS,
  tokensSoFar,
  type Consultation,
  type ContextOverride,
  type Home,
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
  /** A Proposal the change drafted, saved with the Thread. */
  readonly proposal?: Proposal;
  /** The user's messages, logged earlier, whose delivery the change marks. */
  readonly marked?: DeliveryMarking;
  readonly event: Event;
}

/**
 * What became of user messages that waited for a safe point; ones never delivered wait again when
 * a Stage's next run carries them.
 */
export interface DeliveryMarking {
  readonly messageIds: readonly string[];
  readonly delivery: MessageDelivery;
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
    runningTurnTokens: NO_TOKENS,
    startedAt,
    openDecision: undefined,
    stageThread: false,
    consultation: undefined,
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
  start: TaskThreadStart,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  return threadOnTask(id, start, startedAt, { stageThread: false, consultation: undefined });
}

/**
 * A Stage Thread on the Task (spec §2.4): an Agent works a Stage in it, titled by The Office with
 * the Stage and the person, and The Office sends its messages.
 */
export function startStageThread(
  id: string,
  start: TaskThreadStart,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  return threadOnTask(id, start, startedAt, { stageThread: true, consultation: undefined });
}

/**
 * A Consultation on the Task (spec §2.4): the Consultant, whose Role `start` names, answers the
 * Decision the Agent put to them, in a sub-thread titled with both people.
 */
export function startConsultationThread(
  id: string,
  start: TaskThreadStart,
  consultation: Consultation,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  return threadOnTask(id, start, startedAt, { stageThread: false, consultation });
}

/** Where a Thread on an Initiative is, who answers in it, and what it is called. */
export interface InitiativeThreadStart {
  readonly initiativeId: string;
  readonly roleKey: string;
  readonly title: string;
}

/**
 * A Thread on an Initiative, where the CTO shapes it with the user, titled by The Office: its first
 * message is The Office's opening, not the user's.
 */
export function startInitiativeThread(
  id: string,
  { initiativeId, roleKey, title }: InitiativeThreadStart,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  return titledThread(id, { kind: "initiative", initiativeId }, { roleKey, title }, startedAt, {
    stageThread: false,
    consultation: undefined,
  });
}

function threadOnTask(
  id: string,
  { taskId, ...person }: TaskThreadStart,
  startedAt: Date,
  kind: Pick<Thread, "stageThread" | "consultation">,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  return titledThread(id, { kind: "task", taskId }, person, startedAt, kind);
}

function titledThread(
  id: string,
  home: Home,
  { roleKey, title }: { readonly roleKey: string; readonly title: string },
  startedAt: Date,
  { stageThread, consultation }: Pick<Thread, "stageThread" | "consultation">,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  const problems = titleProblems(title);
  if (problems.length > 0) throw new ThreadRefused(problems);
  const thread: Thread = {
    id,
    home,
    roleKey,
    title: title.trim(),
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: NO_TOKENS,
    runningTurnTokens: NO_TOKENS,
    startedAt,
    openDecision: undefined,
    stageThread,
    consultation,
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

/**
 * A session the Context policy's move starts for the person, before its first call, on the engine
 * their card picks.
 */
export function freshSession(
  id: string,
  {
    roleKey,
    cardVersion,
    officeInstructionsVersion,
    engineId,
    changesAllowed,
  }: Pick<
    ThreadSession,
    "roleKey" | "cardVersion" | "officeInstructionsVersion" | "engineId" | "changesAllowed"
  >,
  startedAt: Date,
): ThreadSession {
  return {
    id,
    roleKey,
    cardVersion,
    officeInstructionsVersion,
    engineId,
    startedAt,
    lastCallAt: undefined,
    contextTokens: 0,
    startContextTokens: undefined,
    full: false,
    changesAllowed,
  };
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
  /** The Brief a new session starts with, kept on the move's line when the move starts one. */
  readonly brief: string;
}

/**
 * The person takes the user's message: it is logged, with the move when it wasn't simply
 * continuing a warm session, and the Thread is answering. The moment's override is spent. Refused
 * while the person is still answering: a chat has no barge-in.
 */
export function beginAnswer(thread: Thread, answering: Answering): ThreadChange<MessagesLogged> {
  const { said } = answering;
  return begin(thread, answering, [...movedLines(thread, answering, said.at), said], said.at);
}

/**
 * The user writes into a Stage Thread while the Stage's work runs in it (barge-in, spec §2.4): the
 * message is logged waiting for the next safe point, between tool calls, and the Thread goes on
 * answering. Refused once the Stage's work there has ended.
 */
export function bargeIn(
  thread: Thread,
  { id, text, at }: Pick<Message, "id" | "at"> & { readonly text: string },
): ThreadChange<MessagesLogged> {
  if (!thread.stageThread) throw new Error(`Thread ${thread.id} is not a Stage Thread.`);
  if (thread.state !== "answering") {
    throw new ThreadRefused(["The Stage ended before your message went. Send it again."]);
  }
  const said: Message = { kind: "user", id, threadId: thread.id, text, delivery: "waiting", at };
  const logged = logMessages(thread, [said], at);
  if (!logged) throw new Error("A barge-in always logs its message.");
  return logged;
}

/**
 * Marks the user's messages as having reached the person, as never going to, when the Stage's
 * work ended first, or as waiting again, when the Stage's next run carries them. Undefined when
 * there are none.
 */
export function markDelivery(
  thread: Thread,
  marking: DeliveryMarking,
  markedAt: Date,
): ThreadChange<DeliveryMarked> | undefined {
  if (marking.messageIds.length === 0) return undefined;
  return {
    thread,
    logged: [],
    marked: marking,
    event: new DeliveryMarked(thread, marking.messageIds, marking.delivery, markedAt),
  };
}

/** A Decision the person opens in the Thread they work in, or The Office does, and when. */
export interface DecisionOpening extends DecisionDraft {
  readonly id: string;
  readonly askedAt: Date;
  /** The Office asks, not the Thread's person (spec §9: it has no person in tier 1). */
  readonly byTheOffice?: boolean;
  /** The Consultant, by the key of their Role, the Agent's question is put to instead of the user. */
  readonly putTo?: string;
  /** The ids of the Task's Attachments, which are all a Decision may name. */
  readonly attachmentsOfTheTask?: readonly string[];
}

/**
 * The person opens a Decision (spec §2.4): its card is logged, and the Thread waits on it until the
 * user answers. Refused in a chat, which only talks, while another Decision waits, and with every
 * problem of what is asked, in words the person acts on.
 */
export function openDecision(
  thread: Thread,
  {
    id,
    askedAt,
    byTheOffice = false,
    putTo,
    attachmentsOfTheTask = [],
    attachmentIds = [],
    ...draft
  }: DecisionOpening,
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
  const problems = [
    ...decisionProblems(draft),
    ...attachmentProblems(attachmentIds, attachmentsOfTheTask),
  ];
  if (problems.length > 0) throw new ThreadRefused(problems);
  const decision: Decision = {
    ...draft,
    attachmentIds: [...new Set(attachmentIds)],
    id,
    threadId: thread.id,
    taskId: thread.home.taskId,
    roleKey: byTheOffice ? undefined : (thread.session?.roleKey ?? thread.roleKey),
    askedAt,
    putTo,
    passedOn: [],
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

/** A Proposal the Thread's person drafts, and when. */
export interface ProposalDrafting {
  readonly id: string;
  readonly draftedAt: Date;
  readonly change: ProposedChange;
}

/**
 * The person drafts a Proposal (spec §2.2): its card is logged, and it waits on the user, who
 * applies or declines it, while the person goes on. Refused with every problem of what is
 * proposed, in words the person acts on.
 */
export function draftProposal(
  thread: Thread,
  { id, draftedAt, change }: ProposalDrafting,
): ThreadChange<ProposalDrafted> {
  const problems = proposedChangeProblems(change);
  if (problems.length > 0) throw new ProposalRefused(problems);
  const draftedBy = thread.session?.roleKey ?? thread.roleKey;
  const proposal: Proposal = {
    id,
    threadId: thread.id,
    draftedBy,
    draftedAt,
    change,
    status: { kind: "open" },
  };
  const card: Message = {
    kind: "proposal",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: draftedAt,
    roleKey: draftedBy,
    proposalId: id,
  };
  return {
    thread,
    logged: [card],
    proposal,
    event: new ProposalDrafted(thread, proposal),
  };
}

/** The user's answer to the Thread's open Decision, as the person takes it under the move. */
export interface DecisionAnswering extends Opening {
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  /** The id of the answer's line in the log, which the session is sent it by. */
  readonly messageId: string;
  readonly answeredAt: Date;
  /** The Consultant who answered, by the key of their Role; undefined when the user did. */
  readonly answeredBy?: string;
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
  const { decisionId, answer, messageId, answeredAt, answeredBy } = answering;
  const open = answerableDecision(thread, decisionId, answer);
  if (thread.state === "answering") {
    throw new ThreadRefused([
      `${answering.personName} is still answering. Answer once they finish.`,
    ]);
  }
  const decision: Decision = { ...open, answer: { ...answer, answeredAt, answeredBy } };
  const line: Message = {
    kind: "decision-answer",
    id: messageId,
    threadId: thread.id,
    at: answeredAt,
    decisionId,
    answer,
  };
  const moved = movedLines(thread, answering, answeredAt);
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

/** The user's answer to a Decision that no session takes, and when. */
export interface DecisionRecording {
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  readonly messageId: string;
  readonly answeredAt: Date;
  readonly answeredBy?: string;
}

/**
 * The user answers a Decision whose answer goes to the Task's Pipeline, not into a session: The
 * Office's own, and an Agent's in a Stage Thread, whose session ended with its Stage. The answer
 * is logged and the Decision answered; the walk takes it from there.
 */
export function recordDecisionAnswer(
  thread: Thread,
  { decisionId, answer, messageId, answeredAt, answeredBy }: DecisionRecording,
): ThreadChange<DecisionAnswered> {
  const open = answerableDecision(thread, decisionId, answer);
  const decision: Decision = { ...open, answer: { ...answer, answeredAt, answeredBy } };
  const line: Message = {
    kind: "decision-answer",
    id: messageId,
    threadId: thread.id,
    at: answeredAt,
    decisionId,
    answer,
  };
  const answered: Thread = { ...thread, openDecision: undefined };
  return {
    thread: answered,
    logged: [line],
    decision,
    event: new DecisionAnswered(answered, decision, answeredAt),
  };
}

/** The Thread's open Decision, when it is the one answered and the answer is one. */
function answerableDecision(thread: Thread, decisionId: string, answer: DecisionAnswer): Decision {
  const open = thread.openDecision;
  if (open?.id !== decisionId) throw new ThreadRefused(["This Decision is answered already."]);
  const problems = answerProblems(open, answer);
  if (problems.length > 0) throw new ThreadRefused(problems);
  return open;
}

/** The move's line, unless it was simply continuing a warm session. */
function movedLines(thread: Thread, opening: Opening, at: Date): Message[] {
  return opening.decision.reason === "cache-warm" ? [] : [contextLineOf(thread, opening, at)];
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
  return begin(thread, opening, [contextLineOf(thread, opening, openedAt)], openedAt);
}

/**
 * The person is asked again in a Thread The Office stopped them answering in, such as a
 * Consultation the fire alarm stopped (spec §2.8): as an opening, but the Thread may have its
 * session, which the Context policy's move continues or replaces.
 */
export function beginAskingAgain(
  thread: Thread,
  opening: Opening,
  askedAt: Date,
): ThreadChange<MessagesLogged> {
  return begin(thread, opening, [contextLineOf(thread, opening, askedAt)], askedAt);
}

/**
 * The person starts on a Stage in its Stage Thread, a new one or the previous Stage's continued:
 * the move at the Stage boundary is logged whatever it is, and the Thread is answering until the
 * Stage ends.
 */
export function beginStageWork(
  thread: Thread,
  opening: Opening,
  startedAt: Date,
): ThreadChange<MessagesLogged> {
  if (!thread.stageThread) throw new Error(`Thread ${thread.id} is not a Stage Thread.`);
  return begin(thread, opening, [contextLineOf(thread, opening, startedAt)], startedAt);
}

/** How a Stage's work in its Stage Thread ended, in the lines its log closes with. */
export interface StageWorkEnding {
  readonly roleKey: string;
  /** The person's Handover note in their result, if they wrote one. */
  readonly handoverNote: string | undefined;
  /** Why the Stage failed, or that the user held it, when either. */
  readonly closing: StageWorkClosing | undefined;
}

/**
 * The Stage's work in its Stage Thread ends: its Handover note and its closing line, if any, are
 * logged, and the Thread waits.
 */
export function endStageWork(
  thread: Thread,
  { roleKey, handoverNote, closing }: StageWorkEnding,
  endedAt: Date,
): ThreadChange<MessagesLogged | TurnEnded> | undefined {
  const lines: MessageDraft[] = [
    ...(handoverNote === undefined
      ? []
      : [{ kind: "handover-note" as const, roleKey, text: handoverNote }]),
    ...(closing === undefined ? [] : [closing]),
  ];
  const messages = lines.map((line): Message => ({
    ...line,
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: endedAt,
  }));
  const waiting: Thread = { ...settleRunningTurn(thread), state: "waiting" };
  if (messages.length > 0) return logMessages(waiting, messages, endedAt);
  if (thread.state === "waiting") return undefined;
  return { thread: waiting, logged: [], event: new TurnEnded(waiting, endedAt) };
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
    ...settleRunningTurn(thread),
    state: "answering",
    override: undefined,
    session: newSession ?? thread.session,
  };
  const logged = logMessages(answering, messages, at);
  if (!logged) throw new Error("Starting an answer always logs a message.");
  return logged;
}

function contextLineOf(thread: Thread, { decision, brief }: Opening, at: Date): Message {
  return {
    kind: "context",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at,
    move: decision.move,
    reason: decision.reason,
    contextTokens: decision.contextTokens,
    briefTokens: decision.briefTokens,
    brief: decision.briefTokens === undefined ? undefined : brief,
  };
}

/** How a turn of the person's ended, as the engine counted it. */
export interface TurnCount {
  readonly usage: TokenTotals;
  /** The session's context after the turn. */
  readonly contextTokens: number;
  /** The context neared its limit, so The Office asks for a Handover note next. */
  readonly handingOver: boolean;
  /**
   * The Office goes on sending the person messages itself, as it does in a Stage Thread until the
   * Stage ends: the Thread stays answering.
   */
  readonly officeSendsNext: boolean;
  readonly endedAt: Date;
}

/**
 * Counts the turn's tokens on the Thread, in place of the running count made during it, and its
 * session's context. The Thread waits for the
 * user again, unless the person writes a Handover note next.
 */
export function endTurn(
  thread: Thread,
  { usage, contextTokens, handingOver, officeSendsNext, endedAt }: TurnCount,
): ThreadChange<TurnEnded> {
  if (!thread.session) throw new Error(`Thread ${thread.id} has no session to end a turn of.`);
  const ended: Thread = {
    ...thread,
    state: handingOver || officeSendsNext ? "answering" : "waiting",
    tokens: addTokens(thread.tokens, usage),
    runningTurnTokens: NO_TOKENS,
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

/**
 * Counts the running turn's tokens so far on the Thread, until the turn's own count replaces
 * them; none once the person no longer answers in it.
 */
export function countRunningTurn(
  thread: Thread,
  soFar: TokenTotals,
  countedAt: Date,
): ThreadChange<TokensCounted> | undefined {
  if (thread.state !== "answering") return undefined;
  const counted: Thread = { ...thread, runningTurnTokens: soFar };
  return { thread: counted, logged: [], event: new TokensCounted(counted, countedAt) };
}

/**
 * A turn whose session ended before the engine counted it keeps the count made so far, as the
 * tokens it spent: the next turn, or the Stage's end, adds it to the ended turns'.
 */
function settleRunningTurn(thread: Thread): Thread {
  return { ...thread, tokens: tokensSoFar(thread), runningTurnTokens: NO_TOKENS };
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
  const waiting: Thread = { ...settleRunningTurn(thread), state: "waiting", session };
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

/**
 * The Consultant can't answer the Decision put to them, such as when nobody fills their Role any
 * more: it waits on the user instead, as a missing person falls back to the user (spec §2.2). The
 * event is the one that tells the user a Decision waits.
 */
export function putDecisionToUser(
  thread: Thread,
  decisionId: string,
  reopenedAt: Date,
): ThreadChange<DecisionReopened> | undefined {
  const open = thread.openDecision;
  if (open?.id !== decisionId || open.putTo === undefined) return undefined;
  const decision: Decision = { ...open, putTo: undefined };
  const waiting: Thread = { ...thread, openDecision: decision };
  return {
    thread: waiting,
    logged: [],
    decision,
    event: new DecisionReopened(waiting, decision, reopenedAt),
  };
}

/** A Consultant passing on the approval put to them: to whom (undefined for the user), and why. */
export interface PassingOn {
  readonly decisionId: string;
  /** The Consultant passing it on, by the key of their Role. */
  readonly by: string;
  readonly to: string | undefined;
  readonly reason: string;
  readonly passedOnAt: Date;
}

/**
 * The Consultant an approval, or The Office's Decision, is put to passes it on (spec §2.2, §2.3),
 * and it waits on the next one up or the user. Refused for an Agent's question, which they answer,
 * and once it no longer waits on them. The event is the one that tells the user when it waits on
 * them.
 */
export function passDecisionOn(
  thread: Thread,
  { decisionId, by, to, reason, passedOnAt }: PassingOn,
): ThreadChange<DecisionReopened> {
  const open = thread.openDecision;
  if (open?.id !== decisionId || open.putTo !== by) {
    throw new ThreadRefused([
      "This Decision no longer waits on you: it was answered or passed on. There is nothing left to answer.",
    ]);
  }
  // The Office's own Decision is put to the CTO first and passed on to the user (spec §2.3).
  if (!isApproval(open) && open.roleKey !== undefined) {
    throw new ThreadRefused([
      "Only an approval is passed on. Answer the question with one of its options or in your own words.",
    ]);
  }
  if (reason.trim() === "") throw new ThreadRefused(["Say why you pass it on."]);
  const decision: Decision = {
    ...open,
    putTo: to,
    passedOn: [...open.passedOn, { roleKey: by, reason: reason.trim(), passedOnAt }],
  };
  const waiting: Thread = { ...thread, openDecision: decision };
  return {
    thread: waiting,
    logged: [],
    decision,
    event: new DecisionReopened(waiting, decision, passedOnAt),
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
