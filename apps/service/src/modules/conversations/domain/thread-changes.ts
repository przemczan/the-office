import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineId } from "../../engine/index.js";
import type { ContextDecision } from "./context-policy.js";
import {
  answerProblems,
  attachmentProblems,
  decisionProblems,
  decisionSummary,
  isApproval,
  type AnswerGivenBy,
  type Decision,
  type DecisionAnswer,
  type DecisionDraft,
} from "./decision.js";
import {
  ContextOverrideChosen,
  ContextRead,
  DeliveryMarked,
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  MessagesLogged,
  ProposalDrafted,
  ThreadRenamed,
  ThreadSessionMovedToEngine,
  ThreadStarted,
  TokensCounted,
  TurnEnded,
} from "./conversation-events.js";
import {
  engineSwitchedWords,
  type Message,
  type MessageDelivery,
  type MessageDraft,
  type MessageImage,
  type StageSessionRestartedLine,
  type StageWorkClosing,
} from "./message.js";
import type { OpenPage } from "./open-page.js";
import { proposedChangeProblems, type Proposal, type ProposedChange } from "./proposal.js";
import { ProposalRefused } from "./proposal-refused.js";
import type { StageContextLimits } from "./stage-context-limits.js";
import {
  addTokens,
  isPersonsChat,
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
import type { UserRef } from "./user.js";

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
 * from the Threads before it. Untitled until its first message unless The Office gives it `title`,
 * as the Project page's Set up test targets does. Refused when the person's Chat is off.
 */
export function startChatThread(
  id: string,
  person: ChatPerson,
  startedAt: Date,
  title?: string,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  if (!person.chat) {
    throw new ThreadRefused([
      `Chat is off for ${person.name}: talk to them on a Task, or turn Chat on on their Role card.`,
    ]);
  }
  if (title !== undefined) {
    const problems = titleProblems(title);
    if (problems.length > 0) throw new ThreadRefused(problems);
  }
  const thread: Thread = {
    id,
    home: { kind: "chat", roleKey: person.roleKey },
    roleKey: person.roleKey,
    title: title?.trim(),
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: NO_TOKENS,
    runningTurnTokens: NO_TOKENS,
    startedAt,
    openDecisions: [],
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

/** Where a Consultation is, whose it is and what it is called. */
export interface ConsultationThreadStart {
  /** The asker's Task, or the callee's chat for a call made outside a Task (spec §2.4). */
  readonly home: Extract<Home, { kind: "task" | "chat" }>;
  readonly roleKey: string;
  readonly title: string;
}

/**
 * A Consultation (spec §2.4): the Consultant, whose Role `start` names, answers the Decision put
 * to them, in a sub-thread titled with both people, on the asker's Task or in their own chat.
 */
export function startConsultationThread(
  id: string,
  { home, ...person }: ConsultationThreadStart,
  consultation: Consultation,
  startedAt: Date,
): { readonly thread: Thread; readonly event: ThreadStarted } {
  if (home.kind === "chat" && home.roleKey !== person.roleKey) {
    throw new Error("A Consultation outside a Task opens in the callee's own chat.");
  }
  return titledThread(id, home, person, startedAt, { stageThread: false, consultation });
}

/** Where a Thread on an Initiative is, who answers in it, and what it is called. */
export interface InitiativeThreadStart {
  readonly initiativeId: string;
  readonly roleKey: string;
  readonly title: string;
}

/**
 * A Thread on an Initiative, where whoever shapes Initiatives shapes it with the user or whoever
 * plans plans its Tasks,
 * titled by The Office: its first message is The Office's opening, not the user's.
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
    openDecisions: [],
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
    heldDuties,
    standInFor,
  }: Pick<
    ThreadSession,
    | "roleKey"
    | "cardVersion"
    | "officeInstructionsVersion"
    | "engineId"
    | "changesAllowed"
    | "heldDuties"
    | "standInFor"
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
    heldDuties,
    ...(standInFor !== undefined && { standInFor }),
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
 * while the person is still answering: a message then comes with `bargeIn` instead.
 */
export function beginAnswer(thread: Thread, answering: Answering): ThreadChange<MessagesLogged> {
  const { said } = answering;
  return begin(thread, answering, [...movedLines(thread, answering, said.at), said], said.at);
}

/** The user's message written while the person answers, as `bargeIn` logs it. */
export interface BargingIn extends Pick<Message, "id" | "at"> {
  readonly text: string;
  readonly writtenBy: UserRef;
  /** The page open beside the chat drawer as it was sent (spec §2.4). */
  readonly openPage?: OpenPage;
  /** Who answers, which a Thread other than a Stage Thread names when it refuses the message. */
  readonly personName?: string;
  /** The images it carries, none when empty. */
  readonly images?: readonly MessageImage[];
}

/**
 * The user writes into a Thread while the person answers in it, or a Stage's work runs there
 * (barge-in, spec §2.4): the message is logged waiting for the next safe point, between tool
 * calls, and the Thread goes on answering. Refused once the answer, or the Stage's work, has ended.
 */
export function bargeIn(
  thread: Thread,
  { id, text, at, writtenBy, openPage, personName, images = [] }: BargingIn,
): ThreadChange<MessagesLogged> {
  if (thread.state !== "answering") throw new ThreadRefused([finishedFirst(thread, personName)]);
  const said: Message = {
    kind: "user",
    id,
    threadId: thread.id,
    text,
    delivery: "waiting",
    at,
    writtenBy,
    openPage,
    ...(images.length > 0 && { images }),
  };
  const logged = logMessages(thread, [said], at);
  if (!logged) throw new Error("A barge-in always logs its message.");
  return logged;
}

/** Why a message written to a Thread that stopped answering as it went is refused. */
export function finishedFirst(thread: Thread, personName: string | undefined): string {
  if (thread.stageThread) return "The Stage ended before your message went. Send it again.";
  if (personName === undefined)
    throw new Error(`Thread ${thread.id} refuses with no person named.`);
  return `${personName} finished before your message went. Send it again.`;
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
  /**
   * The ids of the Task's Attachments, which are all a Decision may name; the Initiative's own for
   * one on no Task in an Initiative's Thread.
   */
  readonly attachmentsOfTheTask?: readonly string[];
  /**
   * The Task the Decision is on: the Thread's own in a Thread on a Task, where it may be left out,
   * and one of the Initiative's Tasks, which the caller has checked, in an Initiative's planning
   * Thread, or none there for the Initiative as a whole.
   */
  readonly taskId?: string;
  /** Which of an Initiative's Threads it is opened in, as Work tells them apart; planning unless said. */
  readonly initiativeThread?: InitiativeThreadKind;
}

/** An Initiative's shaping Thread, or one of its planning Threads. */
export type InitiativeThreadKind = "shaping" | "planning";

/**
 * The person opens a Decision (spec §2.4): its card is logged, and the Thread waits on it until the
 * user answers. In a Thread on a Task it is on that Task, and refused while another Decision waits.
 * In an Initiative's planning Thread it names one of the Initiative's Tasks, several may be open,
 * and it is refused while another waits on the same Task; naming none, there or in the shaping
 * Thread, it is on the Initiative as a whole, one at a time. In a person's chat one opens on no
 * Task, one at a time, waiting on the user inline there or put to a person; a Consultation in a
 * chat opens only a call. Refused with every problem of what is asked, in words the person acts on.
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
    taskId: named,
    initiativeThread = "planning",
    ...draft
  }: DecisionOpening,
): ThreadChange<DecisionOpened> {
  const taskId = decisionTaskOf(thread, named, putTo, initiativeThread);
  const problems = [
    ...decisionProblems(draft),
    ...attachmentProblems(
      attachmentIds,
      attachmentsOfTheTask,
      thread.home.kind === "initiative" && taskId === undefined ? "Initiative" : "Task",
    ),
  ];
  if (problems.length > 0) throw new ThreadRefused(problems);
  const decision: Decision = {
    ...draft,
    kind: draft.kind ?? "form",
    attachmentIds: [...new Set(attachmentIds)],
    id,
    threadId: thread.id,
    taskId,
    roleKey: byTheOffice ? undefined : (thread.session?.roleKey ?? thread.roleKey),
    askedAt,
    putTo,
    passedOn: [],
    answer: undefined,
    inStageThread: thread.stageThread,
  };
  const card: Message = {
    kind: "decision",
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: askedAt,
    roleKey: decision.roleKey,
    decisionId: id,
  };
  const waiting: Thread = { ...thread, openDecisions: [...thread.openDecisions, decision] };
  return {
    thread: waiting,
    logged: [card],
    decision,
    event: new DecisionOpened(waiting, decision),
  };
}

/**
 * The Task a Decision opened in the Thread is on, refused where none may be opened. A person's chat
 * opens one on no Task, put to someone or waiting on the user inline there (spec §2.4, §2.7), one at
 * a time; a Consultation sitting in a chat opens only a call, on no Task. In an Initiative's Thread
 * one naming no Task, asked of the user or a call, is on no Task, about the Initiative as a whole,
 * and one at a time; in its planning Thread one naming a Task is on it, one per Task.
 */
function decisionTaskOf(
  thread: Thread,
  named: string | undefined,
  putTo: string | undefined,
  initiativeThread: InitiativeThreadKind,
): string | undefined {
  const { home, openDecisions } = thread;
  switch (home.kind) {
    case "chat": {
      if (named !== undefined) {
        throw new ThreadRefused([
          "A Decision in your chat is on no Task: leave taskId out, and ask about the Task in the form.",
        ]);
      }
      if (!isPersonsChat(thread) && putTo === undefined) {
        throw new ThreadRefused(["A Consultation opens no Decision of its own: answer in words."]);
      }
      const [waiting] = openDecisions;
      if (waiting) {
        const what = waiting.putTo === undefined ? "Decision" : "call";
        throw new ThreadRefused([
          `Your ${what} "${decisionSummary(waiting)}" still waits on its answer. End your turn: it comes as your next message.`,
        ]);
      }
      return undefined;
    }
    case "task": {
      if (named !== undefined && named !== home.taskId) {
        throw new ThreadRefused([
          "A Decision here is on this Thread's Task: leave taskId out, or name this Task.",
        ]);
      }
      const [waiting] = openDecisions;
      if (waiting) {
        throw new ThreadRefused([
          `Your Decision "${decisionSummary(waiting)}" still waits on the user. End your turn: their answer comes as your next message.`,
        ]);
      }
      return home.taskId;
    }
    case "initiative": {
      if (named === undefined) return onTheInitiative(openDecisions, initiativeThread);
      if (initiativeThread === "shaping") throw new ThreadRefused([SHAPING_DECISION_ON_A_TASK]);
      const waiting = openDecisions.find((decision) => decision.taskId === named);
      if (waiting) {
        throw new ThreadRefused([
          `Your Decision "${decisionSummary(waiting)}" on this Task still waits on the user. Plan the Tasks that don't wait for it; its answer comes as a message.`,
        ]);
      }
      return named;
    }
  }
}

/** Why a Decision in an Initiative's shaping Thread can't name a Task. */
export const SHAPING_DECISION_ON_A_TASK =
  "In the shaping Thread a Decision is on no Task: leave taskId out.";

/**
 * A Decision in an Initiative's Thread naming no Task (spec §2.4): on the Initiative as a whole,
 * waiting on the user or a call put to a person, one at a time in the Thread.
 */
function onTheInitiative(
  openDecisions: readonly Decision[],
  initiativeThread: InitiativeThreadKind,
): undefined {
  const waiting = openDecisions.find((decision) => decision.taskId === undefined);
  if (waiting) {
    const goOn =
      initiativeThread === "planning"
        ? "End your turn, or plan the Tasks that don't need it: its answer comes as your next message."
        : "End your turn: it comes as your next message.";
    throw new ThreadRefused([
      `Your Decision "${decisionSummary(waiting)}" on the Initiative still waits on its answer. ${goOn}`,
    ]);
  }
  return undefined;
}

/** The Thread's open Decision `decisionId`, if it is one. */
export function openDecisionOf(thread: Thread, decisionId: string): Decision | undefined {
  return thread.openDecisions.find((decision) => decision.id === decisionId);
}

function withoutDecision(thread: Thread, decisionId: string): Thread {
  return {
    ...thread,
    openDecisions: thread.openDecisions.filter((decision) => decision.id !== decisionId),
  };
}

function withDecision(thread: Thread, changed: Decision): Thread {
  const others = thread.openDecisions.filter((decision) => decision.id !== changed.id);
  const openDecisions = [...others, changed].toSorted(
    (first, second) => first.askedAt.getTime() - second.askedAt.getTime(),
  );
  return { ...thread, openDecisions };
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
export interface DecisionAnswering extends Opening, AnswerGivenBy {
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  /** The id of the answer's line in the log, which the session is sent it by. */
  readonly messageId: string;
  readonly answeredAt: Date;
  /**
   * The lines of answers given earlier that waited for the person's turn to end, which go to the
   * person with this one (`keepAnswerForTurnEnd`).
   */
  readonly waitingAnswerIds?: readonly string[];
}

/**
 * The user answers the Thread's open Decision: the answer is logged, with the move when it wasn't
 * simply continuing a warm session, the Decision is answered, and the person takes the answer as
 * their next message, with any answers that waited for it, marked delivered. Refused once it is
 * answered, with an answer that isn't one, and while the person is still answering.
 */
export function answerDecision(
  thread: Thread,
  answering: DecisionAnswering,
): ThreadChange<DecisionAnswered> {
  const { decisionId, answeredAt, waitingAnswerIds = [] } = answering;
  const open = answerableDecision(thread, answering);
  if (thread.state === "answering") {
    throw new ThreadRefused([
      `${answering.personName} is still answering. Answer once they finish.`,
    ]);
  }
  const decision = answered(open, answering);
  const line = answerLine(thread, answering);
  const moved = movedLines(thread, answering, answeredAt);
  const begun = begin(withoutDecision(thread, decisionId), answering, [...moved, line], answeredAt);
  return {
    thread: begun.thread,
    logged: begun.logged,
    decision,
    marked: deliveredMarking(waitingAnswerIds),
    event: new DecisionAnswered(begun.thread, decision, answeredAt),
  };
}

/**
 * The user answers a Decision in an Initiative's planning Thread while the person is still
 * answering there (spec §2.4): the Decision is answered at once, so its Task is free for Ready, and
 * its line is logged waiting for the person's turn to end, which hands it over
 * (`deliverWaitingAnswers`). A Thread on a Task refuses, as `answerDecision` does.
 */
export function keepAnswerForTurnEnd(
  thread: Thread,
  recording: DecisionRecording,
  personName: string,
): ThreadChange<DecisionAnswered> {
  const { decisionId, answeredAt } = recording;
  const open = answerableDecision(thread, recording);
  if (thread.home.kind !== "initiative" || thread.state !== "answering") {
    throw new ThreadRefused([`${personName} is still answering. Answer once they finish.`]);
  }
  const decision = answered(open, recording);
  const without = withoutDecision(thread, decisionId);
  return {
    thread: without,
    logged: [answerLine(thread, recording, "waiting")],
    decision,
    event: new DecisionAnswered(without, decision, answeredAt),
  };
}

/**
 * The user dismisses one of the Thread's open Decisions (spec §2.4): it is closed as the user's
 * answer at once, so it leaves Needs you, whether the person answers or not, and its line is logged
 * waiting: the person learns of it with the user's next message in the Thread (or, in an
 * Initiative's Thread, with the waiting answers handed over), never by a turn of its own. Refused
 * as `dismissProblems` says.
 */
export function dismissDecision(
  thread: Thread,
  recording: DecisionRecording,
): ThreadChange<DecisionAnswered> {
  if (recording.answer.kind !== "dismissed") throw new Error("Not a dismissal.");
  const open = answerableDecision(thread, recording);
  const decision = answered(open, recording);
  const without = withoutDecision(thread, recording.decisionId);
  return {
    thread: without,
    logged: [answerLine(thread, recording, "waiting")],
    decision,
    event: new DecisionAnswered(without, decision, recording.answeredAt),
  };
}

/**
 * The person's turn ended with answers waiting for it (`keepAnswerForTurnEnd`): the person takes
 * them, all in one message, under the Context policy's move, and their lines are marked delivered.
 * Refused while the person is still answering, as any message is.
 */
export function deliverWaitingAnswers(
  thread: Thread,
  opening: Opening,
  waitingAnswerIds: readonly string[],
  deliveredAt: Date,
): ThreadChange<MessagesLogged | DeliveryMarked> {
  const marked = deliveredMarking(waitingAnswerIds);
  if (!marked) throw new Error("There are no waiting answers to deliver.");
  const moved = movedLines(thread, opening, deliveredAt);
  if (moved.length > 0) return { ...begin(thread, opening, moved, deliveredAt), marked };
  if (thread.state === "answering") {
    throw new ThreadRefused([`${opening.personName} is still answering.`]);
  }
  const answering: Thread = {
    ...settleRunningTurn(thread),
    state: "answering",
    override: undefined,
  };
  return {
    thread: answering,
    logged: [],
    marked,
    event: new DeliveryMarked(answering, marked.messageIds, marked.delivery, deliveredAt),
  };
}

/**
 * The answer's line in the log; `delivery` only for one that waits for the person's turn to end,
 * as every other reaches them as it is given.
 */
function answerLine(
  thread: Thread,
  { decisionId, answer, messageId, answeredAt, atUsersRequest }: DecisionRecording,
  delivery?: MessageDelivery,
): Message {
  return {
    kind: "decision-answer",
    id: messageId,
    threadId: thread.id,
    at: answeredAt,
    decisionId,
    answer,
    ...(atUsersRequest === undefined ? {} : { atUsersRequest }),
    ...(delivery === undefined ? {} : { delivery }),
  };
}

/** The open Decision with the answer recorded on it, with who gave it. */
function answered(
  open: Decision,
  { answer, answeredAt, user, answeredBy, atUsersRequest, byTheOffice }: DecisionRecording,
): Decision {
  return {
    ...open,
    answer: {
      ...answer,
      answeredAt,
      ...(user === undefined ? {} : { user }),
      ...(answeredBy === undefined ? {} : { answeredBy }),
      ...(atUsersRequest === undefined ? {} : { atUsersRequest }),
      ...(byTheOffice ? { byTheOffice } : {}),
    },
  };
}

function deliveredMarking(messageIds: readonly string[]): DeliveryMarking | undefined {
  return messageIds.length === 0 ? undefined : { messageIds, delivery: "delivered" };
}

/** The user's answer to a Decision that no session takes, and when. */
export interface DecisionRecording extends AnswerGivenBy {
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  readonly messageId: string;
  readonly answeredAt: Date;
}

/**
 * The user answers a Decision whose answer goes to the Task's Pipeline, not into a session: The
 * Office's own, and an Agent's in a Stage Thread, whose session ended with its Stage. The answer
 * is logged and the Decision answered; the walk takes it from there.
 */
export function recordDecisionAnswer(
  thread: Thread,
  recording: DecisionRecording,
): ThreadChange<DecisionAnswered> {
  const { decisionId, answeredAt } = recording;
  const open = answerableDecision(thread, recording);
  const decision = answered(open, recording);
  const without = withoutDecision(thread, decisionId);
  return {
    thread: without,
    logged: [answerLine(thread, recording)],
    decision,
    event: new DecisionAnswered(without, decision, answeredAt),
  };
}

/**
 * The Decision's Task was dropped, or, for one on no Task in an Initiative's Thread, its Initiative
 * ended: the open Decision is closed unanswered, so nobody waits on it,
 * the user or a Consultant, and it can't be answered any more. Its card shows it closed. None for
 * a Decision the Thread doesn't wait on, answered or closed already.
 */
export function closeDecision(
  thread: Thread,
  decisionId: string,
  closedAt: Date,
): ThreadChange<DecisionClosed> | undefined {
  const open = openDecisionOf(thread, decisionId);
  if (!open) return undefined;
  const decision: Decision = { ...open, closedAt };
  const without = withoutDecision(thread, decisionId);
  return {
    thread: without,
    logged: [],
    decision,
    event: new DecisionClosed(without, decision, closedAt),
  };
}

/** The Thread's open Decision, when it is the one answered and the answer is one. */
function answerableDecision(
  thread: Thread,
  { decisionId, answer, byTheOffice }: DecisionRecording,
): Decision {
  const open = openDecisionOf(thread, decisionId);
  if (!open) throw new ThreadRefused(["This Decision is answered already."]);
  const problems = answerProblems(open, answer, { byTheOffice });
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
  opening: StageOpening,
  startedAt: Date,
): ThreadChange<MessagesLogged> {
  if (!thread.stageThread) throw new Error(`Thread ${thread.id} is not a Stage Thread.`);
  return begin(
    { ...thread, stageContextLimits: opening.contextLimits },
    opening,
    [contextLineOf(thread, opening, startedAt)],
    startedAt,
  );
}

/** A Stage's work beginning in its Stage Thread, with the context limits it runs under. */
export interface StageOpening extends Opening {
  /** Undefined for No limit, or on an engine that doesn't report its context. */
  readonly contextLimits: StageContextLimits | undefined;
}

/**
 * A Stage's session handed over at a context limit, and the Stage goes on in `newSession` in the
 * same Stage Thread, which stays answering (spec §2.5): The Office's line says so, with the ended
 * session's context, whether the Handover note was passed on and the fresh session's Brief.
 */
export function restartStageSession(
  thread: Thread,
  {
    newSession,
    ...line
  }: Omit<StageSessionRestartedLine, "kind"> & {
    readonly newSession: ThreadSession;
  },
  restartedAt: Date,
): ThreadChange<MessagesLogged> {
  if (!thread.stageThread) throw new Error(`Thread ${thread.id} is not a Stage Thread.`);
  const restarted: Message = {
    kind: "stage-session-restarted",
    ...line,
    id: crypto.randomUUID(),
    threadId: thread.id,
    at: restartedAt,
  };
  const logged = logMessages(
    { ...settleRunningTurn(thread), session: newSession },
    [restarted],
    restartedAt,
  );
  if (!logged) throw new Error("A restart always logs its line.");
  return logged;
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
  /** Its model's context window; undefined when the engine can't report its context. */
  readonly contextWindow: number | undefined;
  /** The context neared its limit, so The Office asks for a Handover note next. */
  readonly handingOver: boolean;
  /**
   * Another turn follows, so the Thread stays answering: The Office goes on sending the person
   * messages itself, as in a Stage Thread until the Stage ends, or the engine starts one with the
   * user's messages still to land.
   */
  readonly turnFollows: boolean;
  readonly endedAt: Date;
}

/**
 * Counts the turn's tokens on the Thread, in place of the running count made during it, and its
 * session's context. The Thread waits for the
 * user again, unless the person writes a Handover note next.
 */
export function endTurn(
  thread: Thread,
  { usage, contextTokens, contextWindow, handingOver, turnFollows, endedAt }: TurnCount,
): ThreadChange<TurnEnded> {
  if (!thread.session) throw new Error(`Thread ${thread.id} has no session to end a turn of.`);
  const ended: Thread = {
    ...thread,
    state: handingOver || turnFollows ? "answering" : "waiting",
    tokens: addTokens(thread.tokens, usage),
    runningTurnTokens: NO_TOKENS,
    session: {
      ...thread.session,
      lastCallAt: endedAt,
      contextTokens,
      contextWindow,
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
 * Keeps the running turn's latest context reading on the Thread's session, until the turn's own
 * reading replaces it; none once the person no longer answers in it.
 */
export function readRunningContext(
  thread: Thread,
  contextTokens: number,
  readAt: Date,
): ThreadChange<ContextRead> | undefined {
  if (thread.state !== "answering" || !thread.session) return undefined;
  const read: Thread = { ...thread, session: { ...thread.session, contextTokens } };
  return { thread: read, logged: [], event: new ContextRead(read, readAt) };
}

/**
 * A session going on on a Stand-in Engine as its engine's usage window is used up (spec 5.4): the
 * engines by their ids and their names now, the window by the engine port's name, the id of the
 * line that says so, and in a person's Thread the person who went on.
 */
export interface SessionMoveToEngine {
  readonly messageId: string;
  readonly from: EngineId;
  readonly to: EngineId;
  readonly fromName: string;
  readonly toName: string;
  readonly window: string;
  readonly resetsAt: Date;
  /** The person who went on, in a person's Thread; undefined in a Stage Thread. */
  readonly personName?: string;
}

/**
 * Moves the Thread's session to the engine `to`, which it now stands in for `from` on, and logs the
 * `engine-switched` line. The session's files are carried to `to` before, and it resumes there after.
 */
export function moveSessionToEngine(
  thread: Thread,
  { messageId, from, to, fromName, toName, window, resetsAt, personName }: SessionMoveToEngine,
  movedAt: Date,
): ThreadChange<ThreadSessionMovedToEngine> {
  const { session } = thread;
  if (session?.engineId !== from) {
    throw new Error(`Thread ${thread.id}'s session doesn't run on the engine ${from}.`);
  }
  const words = {
    fromName,
    toName,
    window,
    resetsAt: resetsAt.toISOString(),
    ...(personName !== undefined && { personName }),
  };
  const line: Message = {
    id: messageId,
    threadId: thread.id,
    at: movedAt,
    kind: "engine-switched",
    ...words,
  };
  // A second switch still stands in for the engine the session first ran on, as the run does.
  const original = session.standInFor ?? { engineId: from, engineName: fromName };
  const { standInFor: _earlier, ...rest } = session;
  const moved: Thread = {
    ...thread,
    session: {
      ...rest,
      engineId: to,
      ...(original.engineId !== to && {
        standInFor: {
          engineId: original.engineId,
          engineName: original.engineName,
          reason: engineSwitchedWords(words),
        },
      }),
    },
  };
  return {
    thread: moved,
    logged: [line],
    event: new ThreadSessionMovedToEngine(moved, from, to, [line], movedAt),
  };
}

/**
 * Replaces the Thread's session with `fresh`, a new session on the Stand-in Engine `to` that stands
 * in for the engine the old one first ran on, and logs the `engine-switched` line saying it starts
 * fresh (spec §5.4.6): the stand-in is of another engine type, or of one whose session can't be
 * carried, so it can't take the old session. The new session opens after, with a fresh Brief.
 */
export function startSessionFreshOnEngine(
  thread: Thread,
  {
    messageId,
    from,
    to,
    fromName,
    toName,
    window,
    resetsAt,
    personName,
    fresh,
  }: SessionMoveToEngine & { readonly fresh: ThreadSession },
  movedAt: Date,
): ThreadChange<ThreadSessionMovedToEngine> {
  const { session } = thread;
  if (session?.engineId !== from) {
    throw new Error(`Thread ${thread.id}'s session doesn't run on the engine ${from}.`);
  }
  const words = {
    fromName,
    toName,
    window,
    resetsAt: resetsAt.toISOString(),
    ...(personName !== undefined && { personName }),
    fresh: true,
  };
  const line: Message = {
    id: messageId,
    threadId: thread.id,
    at: movedAt,
    kind: "engine-switched",
    ...words,
  };
  // A switch from a stand-in still stands in for the engine the old session first ran on.
  const original = session.standInFor ?? { engineId: from, engineName: fromName };
  const { standInFor: _none, ...started } = fresh;
  const moved: Thread = {
    ...thread,
    session: {
      ...started,
      engineId: to,
      ...(original.engineId !== to && {
        standInFor: {
          engineId: original.engineId,
          engineName: original.engineName,
          reason: engineSwitchedWords(words),
        },
      }),
    },
  };
  return {
    thread: moved,
    logged: [line],
    event: new ThreadSessionMovedToEngine(moved, from, to, [line], movedAt),
  };
}

/**
 * Puts back `previous`, the session `startSessionFreshOnEngine` replaced, when the fresh one never
 * opened on its Stand-in Engine: it is resumed later. Logs nothing. Undefined once the Thread's
 * session is no longer `sessionId`.
 */
export function putBackReplacedSession(
  thread: Thread,
  { sessionId, previous }: { readonly sessionId: string; readonly previous: ThreadSession },
  movedAt: Date,
): ThreadChange<ThreadSessionMovedToEngine> | undefined {
  const { session } = thread;
  if (session?.id !== sessionId) return undefined;
  const back: Thread = { ...thread, session: previous };
  return {
    thread: back,
    logged: [],
    event: new ThreadSessionMovedToEngine(back, session.engineId, previous.engineId, [], movedAt),
  };
}

/**
 * Puts the Thread's session back on the engine it ran on before `moveSessionToEngine`, with the
 * Stand-in it recorded then, when its resume on the Stand-in Engine failed: it is resumed there
 * later. Logs nothing. Undefined when the session is no longer on `from`.
 */
export function moveSessionBack(
  thread: Thread,
  {
    from,
    to,
  }: {
    readonly from: EngineId;
    readonly to: Pick<ThreadSession, "engineId" | "standInFor">;
  },
  movedAt: Date,
): ThreadChange<ThreadSessionMovedToEngine> | undefined {
  const { session } = thread;
  if (session?.engineId !== from) return undefined;
  const { standInFor: _moved, ...rest } = session;
  const back: Thread = {
    ...thread,
    session: {
      ...rest,
      engineId: to.engineId,
      ...(to.standInFor !== undefined && { standInFor: to.standInFor }),
    },
  };
  return {
    thread: back,
    logged: [],
    event: new ThreadSessionMovedToEngine(back, from, to.engineId, [], movedAt),
  };
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
  const failed = failAnswer(thread, reason, failedAt, unopened);
  const reopened = reopenDecision(failed.thread, decision, failedAt);
  return { ...reopened, logged: failed.logged };
}

/**
 * A Decision whose answer never reached a session waits on the user again, its answer cleared: as
 * `failDecisionAnswer` does, for each further answer the failed session was to take with it.
 */
export function reopenDecision(
  thread: Thread,
  decision: Decision,
  reopenedAt: Date,
): ThreadChange<DecisionReopened> {
  if (openDecisionOf(thread, decision.id)) {
    throw new Error(`Thread ${thread.id} has the Decision ${decision.id} open already.`);
  }
  const reopened: Decision = { ...decision, answer: undefined };
  const waiting = withDecision(thread, reopened);
  return {
    thread: waiting,
    logged: [],
    decision: reopened,
    event: new DecisionReopened(waiting, reopened, reopenedAt),
  };
}

/**
 * The Consultant can't answer the Decision put to them, such as when nobody fills their Role any
 * more or their session failed: it waits on the user instead, as a missing person falls back to
 * the user (spec §2.2), kept as passed on by them with `why`, which its card shows. Nothing once it
 * no longer waits on that Consultant. The event is the one that tells the user a Decision waits.
 */
export function putDecisionToUser(
  thread: Thread,
  decisionId: string,
  { consultantKey, why }: { readonly consultantKey: string; readonly why: string },
  reopenedAt: Date,
): ThreadChange<DecisionReopened> | undefined {
  const open = openDecisionOf(thread, decisionId);
  if (open === undefined || open.putTo !== consultantKey) return undefined;
  const decision: Decision = {
    ...open,
    putTo: undefined,
    passedOn: [...open.passedOn, { roleKey: consultantKey, reason: why, passedOnAt: reopenedAt }],
  };
  const waiting = withDecision(thread, decision);
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
  const open = openDecisionOf(thread, decisionId);
  if (!open || open.putTo !== by) {
    throw new ThreadRefused([
      "This Decision no longer waits on you: it was answered or passed on. There is nothing left to answer.",
    ]);
  }
  // The Office's own Decision is put to whoever is asked first when a Stage runs out of tries, and
  // passed on to the user (spec §2.3).
  if (!isApproval(open) && open.roleKey !== undefined) {
    throw new ThreadRefused([
      "Only an approval is passed on. Answer its questions, each with one of its options or in your own words, or ask them to ask again.",
    ]);
  }
  if (reason.trim() === "") throw new ThreadRefused(["Say why you pass it on."]);
  const decision: Decision = {
    ...open,
    putTo: to,
    passedOn: [...open.passedOn, { roleKey: by, reason: reason.trim(), passedOnAt }],
  };
  const waiting = withDecision(thread, decision);
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
