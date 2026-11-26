import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  EngineSessions,
  NoEngineListed,
  type Effort,
  type EngineCapability,
  type EngineId,
  type UsageWindowName,
} from "../../engine/index.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import {
  EngineCascade,
  mcpToolSettingsFor,
  RoleCards,
  type EngineInCascade,
  type SessionRole,
} from "../../people/index.js";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { ApprovalHolds } from "./approval-holds.js";
import { BargeIns } from "./barge-ins.js";
import { SessionSkills, SkillCommands } from "../../skills/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import {
  answerGivenBy,
  answerProblems,
  type Answerer,
  type Decision,
  type DecisionAnswer,
  type GivenAnswer,
  isDismissal,
} from "../domain/decision.js";
import {
  briefBeforeSkillCommand,
  briefedMessage,
  decisionAnswerMessage,
  decisionAnswersOnTasksMessage,
  dismissalNote,
  messageFromUser,
  openingMessage,
  sessionOfficeTools,
  withLeftOutServers,
} from "../domain/session-instructions.js";
import { HANDOVER_REQUEST, handoverRequest } from "../domain/session-instruction-templates.js";
import {
  DEFAULT_CONTEXT_POLICY_SETTINGS,
  decideContext,
  type ContextDecision,
} from "../domain/context-policy.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { DecisionReopened, MessagesLogged } from "../domain/conversation-events.js";
import {
  briefWithMentionedRecords,
  withMentionedRecords,
  type Mention,
  type MentionedRecord,
} from "../domain/mention.js";
import {
  briefWithOpenPageRecord,
  openPageToGive,
  withOpenPageRecord,
  type OpenPage,
  type OpenPageRecord,
} from "../domain/open-page.js";
import {
  engineSwitchedWords,
  latestWriter,
  type Message,
  type MessageDelivery,
  type MessageDraft,
  type MessageImage,
} from "../domain/message.js";
import {
  cascadeLocationOf,
  type SessionStandIn,
  type Thread,
  type ThreadSession,
} from "../domain/thread.js";
import type { UserRef } from "../domain/user.js";
import {
  answerDecision,
  bargeIn,
  beginAnswer,
  beginAskingAgain,
  beginOpening,
  countRunningTurn,
  deliverWaitingAnswers,
  endTurn,
  failAnswer,
  failDecisionAnswer,
  finishedFirst,
  freshSession,
  keepAnswerForTurnEnd,
  logMessages,
  markDelivery,
  moveSessionBack,
  openDecisionOf,
  putBackReplacedSession,
  readRunningContext,
  reopenDecision,
  startSessionFreshOnEngine,
  type Opening,
  type ThreadChange,
  type UnopenedSession,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { FireAlarmLifts } from "./fire-alarm-lifts.js";
import { MentionedRecords } from "./mentioned-records.js";
import { OfficeInstructions } from "./office-instructions.js";
import { sessionLogLines } from "./session-log.js";
import { SubAgentsAndProcesses, type SessionFollowing } from "./sub-agents-and-processes.js";
import { SessionPlaces, type SessionPlace } from "./session-places.js";
import { SessionStartWatch } from "./session-start-watch.js";
import { carrySessionToEngine, type SessionCarrying } from "./session-carry.js";
import { StageThreads } from "./stage-threads.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ThreadImages } from "./thread-images.js";
import { WorkRecords } from "./work-records.js";
import type { TextMask } from "../ports/project-output-masks.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
type ContextUsage = Awaited<ReturnType<EngineSession["readContextUsage"]>>;
type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];
type SessionEvent = EngineSession["events"] extends AsyncIterable<infer Event> ? Event : never;
type TurnEndedEvent = Extract<SessionEvent, { kind: "turn-ended" }>;
type UserMessage = Parameters<EngineSession["send"]>[0];

/** A skill command the user sent (spec §2.4): the library skill, by its name, and its input. */
export interface SkillCommandSent {
  readonly name: string;
  readonly input: string;
}

/** The plugin a session's library skills are in, so it lists each as `office:<name>`. */
const SESSION_SKILLS_PLUGIN = "office";

/**
 * How long a session's process stays up after its last turn, waiting for the next message, and
 * after its last background Sub-agent ended (spec 2.9).
 */
const IDLE_MS = 10 * 60 * 1000;

/** A message the person answers, and where and with what the session that answers it runs. */
interface Answer {
  /** What a resumed session is sent, by the id its turn names it by. */
  readonly said: UserMessage;
  /** What a new session is started with: the Brief, then `said`, unless it is a skill command. */
  readonly briefed: string;
  /**
   * A skill command a new session takes as its own turn after its Brief's (spec §2.4); a running
   * or resumed session takes it as `said`.
   */
  readonly commandAfterBrief?: UserMessage;
  readonly decision: ContextDecision;
  readonly role: SessionRole;
  /** The text of the Office instructions' version the session runs with. */
  readonly officeInstructions: string;
  /**
   * The model the person works with now on the session's engine, a Stand-in Engine's type too,
   * which a resumed session takes too.
   */
  readonly model: string;
  /** The effort the cascade gives with it; null leaves it to the engine's runtime. */
  readonly effort: Effort | null;
  /**
   * The model a level of the cascade set that the new session's engine doesn't offer, which gave
   * way to its default; the Thread says so as the session starts (spec §5.4.5).
   */
  readonly gaveWay?: string;
  /** The session the move replaces, which can't be resumed any more. */
  readonly replaced: ThreadSession | undefined;
  readonly place: SessionPlace;
  /**
   * The Stand-in Engine list that applies where the Thread works, as the cascade gives it: its
   * Project's own or the Office's, and none under an engine override, which never gives way (spec
   * §5.4.6).
   */
  readonly standIns: readonly EngineId[];
  /** The Decisions the message answers, which open again if the answers never reach a session. */
  readonly answers: readonly Decision[];
}

/**
 * What a session is opened with, which resumes it on a Stand-in Engine too. Never the Stand-in
 * Engine list: a turn refused reads the one that applies then (`goOnOnStandIn`).
 */
type Reopening = Pick<Answer, "role" | "officeInstructions" | "model" | "effort" | "place">;

/** What a new session is started with: an Answer but for the Context policy's move. */
type SessionStart = Omit<Answer, "decision" | "answers" | "standIns">;

/** A Stand-in Engine a session goes on on, as its engine's usage window is used up. */
interface StandInAhead {
  readonly standIn: EngineId;
  readonly window: UsageWindowName;
  readonly resetsAt: Date;
}

/**
 * A session carried to a Stand-in Engine as its engine's usage window is used up (spec 5.4): the
 * session as recorded there, what resumes it there, and where it goes back to if that fails.
 */
interface StandInMove {
  readonly session: ThreadSession;
  readonly reopening: Reopening;
  readonly fromName: string;
  readonly toName: string;
  readonly back: Pick<ThreadSession, "engineId" | "standInFor">;
}

/** What the user's message comes with, besides its text. */
export interface SentWith {
  /** The records it mentions, by their links in it. */
  readonly mentions?: readonly Mention[];
  /** Whose Handover note it started from, by their Role's key, when a Link card gave it. */
  readonly handoverNoteFrom?: string;
  /** The page open beside the chat drawer as it was sent (spec §2.4). */
  readonly openPage?: OpenPage;
  /**
   * Reads the message as a skill command among the names the session that takes it offers, as
   * the contracts' `messageCommand` reads it; without it, the message is never one.
   */
  readonly skillCommandAmong?: (
    skillCommandNames: readonly string[],
  ) => SkillCommandSent | undefined;
  /** The images it carries, by the ids of the Attachments `ThreadImages.keep` kept them as. */
  readonly images?: readonly string[];
}

/** The records the session is given with a message, read as it is sent. */
interface GivenRecords {
  readonly mentioned: readonly MentionedRecord[];
  /** The Open page's record for a session that starts on the message. */
  readonly openPage: OpenPageRecord | undefined;
  /** The Open page's record for a running or resumed session, unless it has it already. */
  readonly ofRunningSession: () => Promise<OpenPageRecord | undefined>;
}

/**
 * What the person takes: a user's message, by who wrote it, or The Office's message of answered
 * Decisions, which names who answered in its words (`writtenBy` undefined).
 */
interface Taken {
  readonly id: string;
  readonly text: string;
  readonly writtenBy: UserRef | undefined;
  /** Reads the user's message as a skill command, against the next session's skill commands. */
  readonly skillCommandAmong?: SentWith["skillCommandAmong"];
  /** The images the user's message carries, which never go with a skill command. */
  readonly images?: readonly MessageImage[];
  /**
   * What goes to the session ahead of the user's message, never with a skill command: the notes of
   * the Decisions the user dismissed since the person last heard from them.
   */
  readonly ahead?: string;
}

const NO_RECORDS: GivenRecords = {
  mentioned: [],
  openPage: undefined,
  ofRunningSession: () => Promise.resolve(undefined),
};

/** A session running behind a Thread, read by one loop that logs what it reports. */
interface LiveSession {
  readonly session: EngineSession;
  /** Whose session it is, as the log names them. */
  readonly roleKey: string;
  /** Where it works, which its tool calls are summed up against. */
  readonly folder: string;
  /** Hides the Project's Secret variables in what it writes into the Thread. */
  readonly mask: TextMask;
  /** The Office tools it started with: a running session can't change them. */
  readonly officeTools: readonly string[];
  /** The person writes their Handover note in the turn running now; the session ends after it. */
  handingOver: boolean;
  /** The Agent is in a turn: from a message sent until its turn ends, or a turn the engine began. */
  turnRunning: boolean;
  idle: NodeJS.Timeout | undefined;
  /** The Office ends it: its events finishing then is no surprise. */
  ending: boolean;
  /** Keeps its Sub-agents and Processes, between turns too. */
  readonly following: SessionFollowing;
  /** What it was opened with, which resumes it on a Stand-in Engine. */
  readonly reopening: Reopening;
  /** The message the turn running began with, sent again on a Stand-in Engine if it is refused. */
  turnMessage: UserMessage | undefined;
  /**
   * The id of the Brief the session was started on, when it was: refused as its first turn, it is
   * sent again whole to a session started fresh on a Stand-in Engine, as no Brief goes before it.
   */
  readonly briefId: string | undefined;
  /** Its events read to their end. */
  reading: Promise<void>;
}

/**
 * Runs Threads (spec §2.4, §2.5): each message the user sends goes through the Context policy,
 * which resumes the Thread's session, or starts a fresh one with a Brief; what the session reports
 * goes into The Office's log as it comes. Where a session works is its home's (SessionPlaces); in
 * every home it reads and changes no file: a chat and a Task's planning only read (spec §6), but
 * for the Caretaker's chat with changes allowed (spec §2.4).
 */
@Injectable()
export class ThreadRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadRunner.name);
  private readonly live = new Map<string, LiveSession>();
  /** Sessions still ending, by Thread: a resume of one waits until its process is gone. */
  private readonly endings = new Map<string, Promise<void>>();
  /** The user's messages to the answer running, by Thread, from its start until it ends. */
  private readonly bargeIns = new Map<string, BargeIns>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly engineCascade: EngineCascade,
    private readonly places: SessionPlaces,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly sessionMcpServers: SessionMcpServers,
    private readonly stageThreads: StageThreads,
    private readonly events: EventBus,
    private readonly settings: ContextPolicySettingsService,
    private readonly mentionedRecords: MentionedRecords,
    private readonly fireAlarmLifts: FireAlarmLifts,
    private readonly approvalHolds: ApprovalHolds,
    private readonly officeInstructions: OfficeInstructions,
    private readonly work: WorkRecords,
    private readonly subAgentsAndProcesses: SubAgentsAndProcesses,
    private readonly schedule: Schedule,
    private readonly skillCommands: SkillCommands,
    private readonly threadImages: ThreadImages,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /**
   * Logs the user's message and has the person answer it; the answer comes into the log as it is
   * written. While the person is answering, or a Stage runs in the Thread, the message lands at
   * the next safe point of the turn running instead (barge-in). Refused when nobody fills their
   * Role any more, or in a chat, when their Chat is off. The session gets the record
   * of each Task, Idea or Decision the message mentions with it, and the Open page's; the log keeps
   * the message as written, with the user who wrote it (`writtenBy`), its Open page and whose
   * Handover note it started from (`handoverNoteFrom`) when a Link card gave it. The session is told
   * who wrote it when it starts on it, and when another user wrote the message before.
   */
  async send(
    threadId: string,
    text: string,
    writtenBy: UserRef,
    sent: SentWith = {},
  ): Promise<Thread> {
    const thread = await this.threadOf(threadId);
    const images = await this.threadImages.carried(thread, sent.images ?? []);
    if (thread.stageThread && thread.state === "answering") {
      return this.stageThreads.bargeIn(threadId, text, writtenBy, images);
    }
    const current = await this.personOf(thread);
    if (text.trim() === "" && images.length === 0) {
      throw new ThreadRefused(["Write a message first."]);
    }
    const { mentions = [], handoverNoteFrom } = sent;
    // Only the chat drawer sends one: a Task's or an Initiative's Threads are about their record.
    const openPage = thread.home.kind === "chat" ? sent.openPage : undefined;
    if (thread.state === "answering") {
      // A skill command runs as a turn of its own, never landing inside the one running.
      const session = thread.session;
      const command = await this.skillCommandIn(text, sent.skillCommandAmong, () =>
        session
          ? this.skillCommands.ofSession(session.id)
          : this.skillCommands.forRole(current.roleKey),
      );
      if (command) {
        throw new ThreadRefused([
          `${current.card.name} is answering; send the skill command once they finish.`,
        ]);
      }
      return this.bargeIn(thread, current, { text, writtenBy, mentions, openPage, images });
    }
    const said: Message = {
      kind: "user",
      id: randomUUID(),
      threadId,
      text,
      delivery: "delivered",
      at: new Date(),
      writtenBy,
      handoverNoteFrom,
      openPage,
      ...(images.length > 0 && { images }),
    };
    const ofBrief = openPageToGive({ openPage, mentions, log: [], newSession: true });
    const dismissals = await this.waitingDismissals(thread);
    const dismissed = dismissals.map(({ lineId }) => lineId);
    const given: GivenRecords = {
      mentioned: await this.mentionedRecords.read(mentions),
      openPage: ofBrief && (await this.mentionedRecords.openPage(ofBrief)),
      ofRunningSession: () => this.openPageOfRunningSession(threadId, openPage, mentions),
    };
    return this.take(
      thread,
      current,
      {
        id: said.id,
        text,
        writtenBy,
        skillCommandAmong: sent.skillCommandAmong,
        images,
        ...(dismissals.length > 0 && { ahead: dismissals.map(({ note }) => note).join("\n\n") }),
      },
      (latest, opening, command) => {
        const begun = beginAnswer(latest, {
          ...opening,
          said: command ? { ...said, skillCommand: { skill: command.name } } : said,
        });
        // A skill command goes alone: the dismissals wait for the next message.
        return command || dismissed.length === 0
          ? begun
          : { ...begun, marked: { messageIds: dismissed, delivery: "delivered" } };
      },
      [],
      given,
    );
  }

  /**
   * The skill command the message is, among those `offered` (spec §2.4): only when its first word
   * names one of them. An Office command never reaches the service, so one is a message.
   */
  private async skillCommandIn(
    text: string,
    skillCommandAmong: SentWith["skillCommandAmong"],
    offered: () => Promise<readonly { readonly name: string }[]>,
  ): Promise<SkillCommandSent | undefined> {
    // Only a message starting with "/" reads what the session offers.
    if (!skillCommandAmong || !text.startsWith("/")) return undefined;
    return skillCommandAmong((await offered()).map(({ name }) => name));
  }

  /**
   * The user writes while the person answers (barge-in, spec §2.4): the message is logged waiting
   * and goes to the turn running, or to the one about to start, with the records given as with any
   * message to a running session; it is marked delivered once a turn has taken it. Refused once
   * the answer has ended.
   */
  private async bargeIn(
    thread: Thread,
    { card }: SessionRole,
    {
      text,
      writtenBy,
      mentions,
      openPage,
      images,
    }: {
      readonly text: string;
      readonly writtenBy: UserRef;
      readonly mentions: readonly Mention[];
      readonly openPage: OpenPage | undefined;
      readonly images: readonly MessageImage[];
    },
  ): Promise<Thread> {
    const bargeIns = this.bargeIns.get(thread.id);
    if (!bargeIns) throw new ThreadRefused([finishedFirst(thread, card.name)]);
    const mentioned = await this.mentionedRecords.read(mentions);
    // Read before the message is logged, so the log holds only the messages before it.
    const page = await this.openPageOfRunningSession(thread.id, openPage, mentions);
    const fromUser = messageFromUser(text, writtenBy, await this.previousWriter(thread.id));
    const contents = await this.threadImages.contents(images);
    const id = randomUUID();
    const logged = await this.change(thread.id, (latest) =>
      bargeIn(latest, {
        id,
        text,
        writtenBy,
        openPage,
        personName: card.name,
        at: new Date(),
        images,
      }),
    );
    const said = {
      id,
      text: withOpenPageRecord(withMentionedRecords(fromUser, mentioned), page),
      ...(contents.length > 0 && { images: contents }),
    };
    if (!bargeIns.take(said)) await this.mark(thread.id, [id], "not-delivered");
    return logged;
  }

  /** The Open page's record for a running or resumed session, unless it has it already. */
  private async openPageOfRunningSession(
    threadId: string,
    openPage: OpenPage | undefined,
    mentions: readonly Mention[],
  ): Promise<OpenPageRecord | undefined> {
    if (!openPage) return undefined;
    const log = await this.repository.messages(threadId);
    const page = openPageToGive({ openPage, mentions, log, newSession: false });
    return page && (await this.mentionedRecords.openPage(page));
  }

  /**
   * The Decisions the user dismissed in the Thread that the person hasn't heard of yet, each with
   * its note and the line that waits to be marked delivered once the note goes.
   */
  private async waitingDismissals(
    thread: Thread,
  ): Promise<readonly { readonly lineId: string; readonly note: string }[]> {
    const lines = (await this.repository.messages(thread.id)).filter(
      (line) =>
        line.kind === "decision-answer" &&
        line.delivery === "waiting" &&
        line.answer.kind === "dismissed",
    );
    if (lines.length === 0) return [];
    const found = new Map(
      (
        await this.repository.decisionsWithIds(
          lines.flatMap((line) => (line.kind === "decision-answer" ? [line.decisionId] : [])),
        )
      ).map((decision) => [decision.id, decision]),
    );
    return lines.flatMap((line) => {
      if (line.kind !== "decision-answer" || line.answer.kind !== "dismissed") return [];
      const decision = found.get(line.decisionId);
      return decision ? [{ lineId: line.id, note: dismissalNote(decision, line.answer) }] : [];
    });
  }

  /**
   * Answers one of the Thread's open Decisions and has the person take the answer, with its
   * question, as their next message, under the Context policy as any message is, together with any
   * answers that waited for it. In an Initiative's planning Thread an answer given while the person
   * is answering is kept for their turn's end instead (spec §2.4). `answerer` is who answered: a
   * user, a Consultant or a person at the user's request. Refused once it is answered, with an
   * answer that isn't one, and in a Thread on a Task while the person is still answering. Never a
   * dismissal, which starts no turn (`DecisionService.answer` records it); its note goes ahead of
   * the user's next message in the Thread (`send`), or, in an Initiative's Thread, with the
   * waiting answers handed over.
   */
  async answerDecision(
    threadId: string,
    decisionId: string,
    answer: DecisionAnswer,
    answerer: Answerer,
  ): Promise<Thread> {
    const thread = await this.threadOf(threadId);
    const open = openDecisionOf(thread, decisionId);
    if (!open) throw new ThreadRefused(["This Decision is answered already."]);
    if (answer.kind === "dismissed") {
      throw new Error("A dismissal starts no turn: DecisionService records it.");
    }
    const problems = answerProblems(open, answer, answerGivenBy(answerer));
    if (problems.length > 0) throw new ThreadRefused(problems);
    const current = await this.personOf(thread);
    const messageId = randomUUID();
    if (thread.home.kind === "initiative" && thread.state === "answering") {
      return this.change(threadId, (latest) =>
        keepAnswerForTurnEnd(
          latest,
          { decisionId, answer, messageId, answeredAt: new Date(), ...answerGivenBy(answerer) },
          current.card.name,
        ),
      );
    }
    const waiting = await this.waitingAnswers(thread);
    const given: Decision = {
      ...open,
      answer: { ...answer, answeredAt: new Date(), ...answerGivenBy(answerer) },
    };
    const answers = [...waiting.map(({ decision }) => decision), given];
    const said = {
      id: messageId,
      text: await this.answersMessage(thread, answers, answerer),
      writtenBy: undefined,
    };
    // Briefed as the Thread will be once answered: the message, not the Brief, carries this one.
    const answered: Thread = {
      ...thread,
      openDecisions: thread.openDecisions.filter(({ id }) => id !== decisionId),
    };
    return this.take(
      answered,
      current,
      said,
      (latest, opening) =>
        answerDecision(latest, {
          ...opening,
          decisionId,
          answer,
          messageId,
          answeredAt: new Date(),
          ...answerGivenBy(answerer),
          waitingAnswerIds: waiting.map(({ lineId }) => lineId),
        }),
      answers,
    );
  }

  /**
   * Hands the person the answers kept for their turn's end in an Initiative's planning Thread, all
   * in one message: nothing when there are none, or when the person answers again already, as the
   * end of that turn hands them over. Dismissals alone start no turn: they wait for the user's next
   * message, or go along with an answer.
   */
  private async deliverWaitingAnswers(threadId: string): Promise<void> {
    const thread = await this.threadOf(threadId);
    if (thread.home.kind !== "initiative" || thread.state !== "waiting") return;
    const waiting = await this.waitingAnswers(thread);
    if (waiting.every(({ decision }) => isDismissal(decision.answer))) return;
    const current = await this.personOf(thread);
    const decisions = waiting.map(({ decision }) => decision);
    const said = {
      id: randomUUID(),
      text: await this.answersMessage(thread, decisions),
      writtenBy: undefined,
    };
    await this.take(
      thread,
      current,
      said,
      (latest, opening) =>
        deliverWaitingAnswers(
          latest,
          opening,
          waiting.map(({ lineId }) => lineId),
          new Date(),
        ),
      decisions,
    );
  }

  /** The answers logged in the Thread that wait for the person's turn to end, with their Decisions. */
  private async waitingAnswers(
    thread: Thread,
  ): Promise<readonly { readonly lineId: string; readonly decision: Decision }[]> {
    if (thread.home.kind !== "initiative") return [];
    const lines = (await this.repository.messages(thread.id)).filter(
      (line) => line.kind === "decision-answer" && line.delivery === "waiting",
    );
    const waiting = [];
    for (const line of lines) {
      if (line.kind !== "decision-answer") continue;
      const decision = await this.repository.decision(line.decisionId);
      if (decision?.answer) waiting.push({ lineId: line.id, decision });
    }
    return waiting;
  }

  /**
   * What the person is sent for the answered Decisions: in a Thread on a Task its one answer, by
   * `answerer` when given, and in an Initiative's planning Thread every answer, each naming its Task
   * and who gave it, as recorded.
   */
  private async answersMessage(
    thread: Thread,
    answered: readonly Decision[],
    answerer?: Answerer,
  ): Promise<string> {
    const given = answered.flatMap((decision) =>
      decision.answer ? [{ decision, answer: decision.answer }] : [],
    );
    if (thread.home.kind !== "initiative") {
      const [only] = given;
      if (!only) throw new Error(`Thread ${thread.id} has no answer to send.`);
      return decisionAnswerMessage(
        only.decision,
        only.answer,
        answerer ?? (await this.answererOf(only.answer)),
      );
    }
    const onTasks = await readEach(given, async (answer) => ({
      ...answer,
      taskTitle:
        answer.decision.taskId === undefined
          ? undefined
          : await this.work.taskTitle(answer.decision.taskId),
      answerer: await this.answererOf(answer.answer),
    }));
    return decisionAnswersOnTasksMessage(onTasks);
  }

  /**
   * Who gave a recorded answer, as the person is told: the person who gave it for the user at their
   * request, by their name, or else the user who gave it. Only a user's answer and one at their
   * request wait for a turn's end, so neither a Consultant's nor The Office's comes here.
   */
  private async answererOf({ atUsersRequest, user }: GivenAnswer): Promise<Answerer> {
    if (!atUsersRequest) return { kind: "user", user: user ?? null };
    const person = await this.roleCards.find(atUsersRequest.roleKey);
    return {
      kind: "at-users-request",
      ...atUsersRequest,
      name: person?.card.name ?? atUsersRequest.roleKey,
    };
  }

  /**
   * Has the person start on a Thread The Office opened, such as a Task's planning Thread: a new
   * session, given the Brief and `opening`, answers before the user has said anything.
   */
  async open(threadId: string, opening: string): Promise<Thread> {
    return this.startOn(threadId, opening, beginOpening);
  }

  /**
   * Has the person start again on a Thread The Office stopped them answering in, such as a
   * Consultation the fire alarm stopped: as `open`, its session continued or replaced under the
   * Context policy.
   */
  async askAgain(threadId: string, opening: string): Promise<Thread> {
    return this.startOn(threadId, opening, beginAskingAgain);
  }

  private async startOn(
    threadId: string,
    opening: string,
    begin: (thread: Thread, opening: Opening, at: Date) => ThreadChange<MessagesLogged>,
  ): Promise<Thread> {
    const now = new Date();
    const thread = await this.threadOf(threadId);
    const current = await this.personOf(thread);
    const place = await this.places.of(thread);
    const { newSession, ...move } = await this.moveFor(thread, current, place, now);
    const { decision } = move;
    const answering = await this.change(threadId, (latest) =>
      begin(
        latest,
        { personName: current.card.name, decision, newSession, brief: place.brief.text },
        now,
      ),
    );
    this.answerInBackground(answering, {
      said: { id: randomUUID(), text: opening },
      briefed: openingMessage(place.brief.text, opening),
      ...move,
      replaced: undefined,
      place,
      answers: [],
    });
    return answering;
  }

  /**
   * The person takes `said` under the Context policy's move: `begin` logs it and sets the Thread
   * answering, and the session answers once the call that asked returns. `said` may answer
   * Decisions, which open again when the session never starts. The records given with it brief a
   * new session, or come with it into a running or resumed one.
   */
  private async take<Event extends DomainEvent>(
    thread: Thread,
    current: SessionRole,
    said: Taken,
    begin: (
      latest: Thread,
      opening: Opening,
      command: SkillCommandSent | undefined,
    ) => ThreadChange<Event>,
    answers: readonly Decision[] = [],
    given: GivenRecords = NO_RECORDS,
  ): Promise<Thread> {
    const opened = await this.places.of(thread);
    const brief = briefWithMentionedRecords(opened.brief, given.mentioned);
    const place = { ...opened, brief: briefWithOpenPageRecord(brief, given.openPage) };
    const { newSession, ...move } = await this.moveFor(thread, current, place, new Date());
    const { decision } = move;
    const goingOn = thread.session;
    const command = said.skillCommandAmong
      ? await this.skillCommandIn(said.text, said.skillCommandAmong, () =>
          newSession || !goingOn
            ? this.skillCommands.forRole(current.roleKey)
            : this.skillCommands.ofSession(goingOn.id),
        )
      : undefined;
    if (command && said.images?.length) {
      throw new ThreadRefused([this.threadImages.skillCommandProblem]);
    }
    if (command && said.writtenBy) {
      return this.takeSkillCommand(thread, current, said, said.writtenBy, command, {
        begin,
        place,
        newSession,
        move,
        answers,
      });
    }
    // Read before the message is logged, so the log holds only the messages before it.
    const openPage = newSession ? undefined : await given.ofRunningSession();
    const contents = await this.threadImages.contents(said.images ?? []);
    const images = contents.length > 0 ? { images: contents } : {};
    const text =
      newSession || !said.writtenBy
        ? said.text
        : messageFromUser(said.text, said.writtenBy, await this.previousWriter(thread.id));
    const answering = await this.change(thread.id, (latest) =>
      begin(
        latest,
        {
          personName: current.card.name,
          decision,
          newSession,
          brief: place.brief.text,
        },
        undefined,
      ),
    );
    const withRecords = withOpenPageRecord(withMentionedRecords(text, given.mentioned), openPage);
    // Held until the answer's turn starts, so a message never starts a turn of its own.
    const bargeIns = new BargeIns(
      (message) => this.live.get(thread.id)?.session.send(message, "next"),
      false,
    );
    this.bargeIns.set(thread.id, bargeIns);
    this.answerInBackground(answering, {
      said: {
        id: said.id,
        text: newSession ? said.text : inOrder(said.ahead, withRecords),
        ...images,
      },
      briefed: briefedMessage(inOrder(place.brief.text, said.ahead), said.text, said.writtenBy),
      ...move,
      replaced: newSession ? thread.session : undefined,
      place,
      answers,
    });
    return answering;
  }

  /**
   * The person takes the user's skill command (spec §2.4): logged as written, it goes to the
   * session as the skill to run with its input, with no heading, Mentions or Open page around it.
   * A new session gets its Brief first, those records in it, and takes the command as the turn
   * after the Brief's.
   */
  private async takeSkillCommand<Event extends DomainEvent>(
    thread: Thread,
    current: SessionRole,
    said: Taken,
    writtenBy: UserRef,
    command: SkillCommandSent,
    {
      begin,
      place,
      newSession,
      move,
      answers,
    }: {
      readonly begin: (
        latest: Thread,
        opening: Opening,
        command: SkillCommandSent | undefined,
      ) => ThreadChange<Event>;
      readonly place: SessionPlace;
      readonly newSession: ThreadSession | undefined;
      readonly move: Omit<Awaited<ReturnType<ThreadRunner["moveFor"]>>, "newSession">;
      readonly answers: readonly Decision[];
    },
  ): Promise<Thread> {
    const answering = await this.change(thread.id, (latest) =>
      begin(
        latest,
        {
          personName: current.card.name,
          decision: move.decision,
          newSession,
          brief: place.brief.text,
        },
        command,
      ),
    );
    const commandMessage: UserMessage = {
      id: said.id,
      text: said.text,
      skillCommand: { skill: `${SESSION_SKILLS_PLUGIN}:${command.name}`, input: command.input },
    };
    const bargeIns = new BargeIns(
      (message) => this.live.get(thread.id)?.session.send(message, "next"),
      false,
    );
    this.bargeIns.set(thread.id, bargeIns);
    this.answerInBackground(
      answering,
      newSession
        ? {
            said: { id: randomUUID(), text: "" },
            briefed: briefBeforeSkillCommand(place.brief.text, writtenBy),
            commandAfterBrief: commandMessage,
            ...move,
            replaced: thread.session,
            place,
            answers,
          }
        : { said: commandMessage, briefed: "", ...move, replaced: undefined, place, answers },
    );
    return answering;
  }

  /** Who wrote the Thread's latest user message; undefined when the user has written none. */
  private async previousWriter(threadId: string): Promise<UserRef | null | undefined> {
    return latestWriter(await this.repository.messages(threadId));
  }

  /** Ends every running session with the service. */
  /**
   * Ends the sessions of the Task's Threads that wait for the user's next message, so none holds
   * the Task's worktree as Publish removes it, as their idle time would have later. A session
   * answering keeps going.
   */
  async endWaiting(taskId: string): Promise<void> {
    const threads = await this.repository.listIn({ kind: "task", taskId });
    // Each ending forgets its session's records, so they are bounded as reads are.
    await readEach(
      threads.filter(({ state }) => state === "waiting"),
      async ({ id }) => {
        await this.endLive(id);
        await this.endings.get(id);
      },
    );
  }

  /**
   * Stops the person answering in the Thread now: their session ends, and the Thread waits for the
   * user again, with why in its log. Nothing when it isn't answering.
   */
  async stopAnswering(threadId: string, reason: string): Promise<void> {
    await this.endLive(threadId);
    await this.change(threadId, (thread) =>
      thread.state === "answering" ? failAnswer(thread, reason, new Date()) : undefined,
    );
    await this.endBargeIns(threadId);
  }

  /**
   * Whether the Thread's session is in a turn now (`LiveSession.turnRunning`), as kept in memory:
   * from a message sent until its turn ends, or a turn the engine began. False for a Thread with
   * no live session, waiting for the user or for a Decision's answer.
   */
  isTurnRunning(threadId: string): boolean {
    return this.live.get(threadId)?.turnRunning ?? false;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.live.keys()].map((threadId) => this.endLive(threadId)));
  }

  /** Who answers in the Thread now; refused when nobody may. */
  private async personOf(thread: Thread): Promise<SessionRole> {
    // The Stage interpreter sends a Stage Thread's messages; the user's come with barge-in.
    if (thread.stageThread) {
      throw new ThreadRefused([
        "An Agent works a Stage in this Thread: The Office sends its messages, so it takes none from you yet.",
      ]);
    }
    const current = await this.roleCards.find(thread.roleKey);
    // Chat being off closes only a person's chat: they still answer on Tasks and Initiatives.
    if (thread.home.kind !== "chat") {
      if (!current) throw new ThreadRefused(["Nobody fills this Thread's Role any more."]);
      return current;
    }
    if (!current) throw new ChatNotFound(thread.roleKey);
    if (!current.card.capabilities.chat) {
      throw new ThreadRefused([
        `Chat is off for ${current.card.name}: their Threads stay readable, and they answer on Tasks. Turn Chat on on their Role card to continue here.`,
      ]);
    }
    return current;
  }

  /**
   * The Context policy's move for the Thread's next message, the session it opens, if any, and the
   * model it runs on: the engine cascade's resolved for the Thread's home (its Task or Initiative)
   * and Project, where it has one. A resumed session keeps its engine, card version and Office
   * instructions and takes the model the person works with now on its engine's type; a changed
   * engine starts the Thread fresh.
   */
  private async moveFor(
    thread: Thread,
    current: SessionRole,
    place: SessionPlace,
    now: Date,
  ): Promise<{
    readonly decision: ContextDecision;
    readonly role: SessionRole;
    readonly officeInstructions: string;
    readonly model: string;
    readonly effort: Effort | null;
    readonly gaveWay?: string;
    readonly standIns: readonly EngineId[];
    readonly newSession: ThreadSession | undefined;
  }> {
    const location = cascadeLocationOf(thread.home, place.project?.id);
    const applying = await this.engineCascade
      .of(thread.roleKey, location)
      .catch(refusedWithoutEngine);
    const standIns = applying.standIns.engineIds;
    const decision = decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: current.card.sessionDefault,
        engineId: applying.engineId,
        forced: applying.standIns.from === "none",
        override: thread.override,
        briefTokens: place.brief.tokens,
        changesAllowed: place.workstation,
        heldDuties: place.heldDuties,
      },
      await this.settings.current(),
    );
    const resumed = decision.move === "resume" ? thread.session : undefined;
    const role = resumed
      ? await this.roleCards.forResumedSession(resumed.roleKey, resumed.cardVersion)
      : current;
    const office = resumed
      ? await this.officeInstructions.forResumedSession(resumed.officeInstructionsVersion)
      : await this.officeInstructions.current();
    if (resumed) {
      // A session on a Stand-in Engine resumes there, with the person's model and effort for its
      // type (spec §5.4.6).
      const work =
        resumed.engineId === applying.engineId
          ? applying
          : await this.engineCascade
              .onEngine(thread.roleKey, resumed.engineId, location)
              .catch(refusedWithoutEngine);
      return {
        decision,
        role,
        officeInstructions: office.text,
        model: work.model,
        effort: work.effort,
        standIns,
        newSession: undefined,
      };
    }
    const { engine, standInFor } = await this.engineForNewSession(applying, {
      roleKey: thread.roleKey,
      location,
      personName: current.card.name,
      needs: needsOf(place),
    });
    const newSession = freshSession(
      randomUUID(),
      {
        ...current,
        officeInstructionsVersion: office.version,
        engineId: engine.engineId,
        changesAllowed: place.workstation,
        heldDuties: place.heldDuties,
        standInFor,
      },
      now,
    );
    return {
      decision,
      role,
      officeInstructions: office.text,
      model: engine.model,
      effort: engine.effort,
      // Of the engine the session landed on, the cascade's or a stand-in (spec §5.4.5).
      ...(engine.gaveWay !== undefined && { gaveWay: engine.gaveWay }),
      standIns,
      newSession,
    };
  }

  /**
   * The engine a new session in a person's Thread opens on, with the person's model and effort
   * there: the cascade's, or while its usage window is known used up, the first Stand-in Engine with
   * room of the list that applies, of any engine type, standing in for it (spec §5.4.6). Under an
   * engine override the list is empty, so the session opens on the forced engine whatever its window.
   */
  private async engineForNewSession(
    applying: EngineInCascade,
    {
      roleKey,
      location,
      personName,
      needs,
    }: {
      readonly roleKey: string;
      readonly location: ReturnType<typeof cascadeLocationOf>;
      readonly personName: string;
      readonly needs: readonly EngineCapability[];
    },
  ): Promise<{
    readonly engine: Pick<EngineInCascade, "engineId" | "model" | "effort" | "gaveWay">;
    readonly standInFor?: SessionStandIn;
  }> {
    const usedUp = this.engine.usedUpUntil(applying.engineId);
    const standIn =
      usedUp &&
      (await this.engine.standInFor(applying.engineId, {
        standIns: applying.standIns.engineIds,
        needs,
      }));
    if (!usedUp || !standIn) return { engine: applying };
    const reason = engineSwitchedWords({
      fromName: usedUp.engineName,
      toName: await this.engine.nameOf(standIn),
      window: usedUp.window,
      resetsAt: usedUp.until.toISOString(),
      personName,
    });
    return {
      engine: await this.engineCascade
        .onEngine(roleKey, standIn, location)
        .catch(refusedWithoutEngine),
      standInFor: { engineId: applying.engineId, engineName: usedUp.engineName, reason },
    };
  }

  /**
   * The Stand-in Engine a session on `running` goes on on before it takes the next message, while
   * that engine's usage window is known used up: the first with room of the list that applies, of
   * any engine type; undefined while it has room or no stand-in has, as under an engine override,
   * where no list applies.
   */
  private async standInAhead(
    running: EngineId,
    { standIns, place }: Pick<Answer, "standIns" | "place">,
  ): Promise<StandInAhead | undefined> {
    const usedUp = this.engine.usedUpUntil(running);
    const standIn =
      usedUp && (await this.engine.standInFor(running, { standIns, needs: needsOf(place) }));
    return usedUp && standIn
      ? { standIn, window: usedUp.window, resetsAt: usedUp.until }
      : undefined;
  }

  /**
   * Whether a session on `from` can be carried to `to` and resumed there: both engines carry
   * sessions, which only Claude Code's do, so both are of the same type (spec §5.4.6). Else the
   * stand-in starts the Thread fresh.
   */
  private async carries(from: EngineId, to: EngineId): Promise<boolean> {
    return (await this.engine.carriesSessionsOf(from)) && (await this.engine.carriesSessionsOf(to));
  }

  /**
   * The person answers once the call that asked returns; a failure goes into the log. Failing here,
   * the session never got the message: a Decision it answered waits on the user again.
   */
  private answerInBackground(thread: Thread, answer: Answer): void {
    const opening = answer.decision.move === "resume" ? undefined : thread.session;
    const unopened = opening && { sessionId: opening.id, previous: answer.replaced };
    const failure = { logged: false };
    void this.answer(thread, answer, failure).catch((error: unknown) =>
      this.fail(thread.id, error, { unopened, answers: answer.answers, logged: failure.logged }),
    );
  }

  /**
   * The person answers in the session running, or in one it opens, which a `SessionStartWatch`
   * writes into the service log; `failure.logged` says that opening it failed and was logged.
   */
  private async answer(
    thread: Thread,
    answer: Answer,
    failure: { logged: boolean },
  ): Promise<void> {
    const { said, decision, role, place } = answer;
    const session = thread.session;
    if (!session) throw new Error(`Thread ${thread.id} answers with no session.`);
    const live = this.live.get(thread.id);
    // Once the Task is Ready the Planner's tools change (spec §2.4): that takes a resume.
    const sameTools = live?.officeTools.join() === place.officeTools.join();
    const goingOn = decision.move === "resume" && live?.session.id === session.id && sameTools;
    // A session on a used-up engine is carried to a stand-in first, which opening it does.
    if (goingOn && !(await this.standInAhead(session.engineId, answer))) {
      this.turnBegan(live);
      live.turnMessage = said;
      live.session.send(said, "later");
      this.bargeIns.get(thread.id)?.turnStarted();
      return;
    }
    const start = new SessionStartWatch(
      {
        threadId: thread.id,
        sessionId: session.id,
        engineId: session.engineId,
        personName: role.card.name,
        move: decision.move === "resume" ? "resume" : "start",
      },
      this.schedule,
      this.logger,
    );
    try {
      await this.openSession(thread, session, answer, start);
    } catch (error) {
      failure.logged = start.failed(error);
      throw error;
    }
  }

  /**
   * Opens the Thread's session on `said`, once the one running before it has ended. A session
   * resumed on an engine whose usage window is known used up is carried to a Stand-in Engine with
   * room first, and resumed there (spec 5.4).
   */
  private async openSession(
    thread: Thread,
    session: ThreadSession,
    answer: Answer,
    start: SessionStartWatch,
  ): Promise<void> {
    const { said, decision, place } = answer;
    await this.endLive(thread.id);
    await this.endings.get(thread.id);
    start.at("refreshing the Thread's folders");
    await place.ready();
    if (decision.move === "resume") {
      const ahead = await this.standInAhead(session.engineId, answer);
      if (ahead && !(await this.carries(session.engineId, ahead.standIn))) {
        // Started fresh there with the Brief, the message after it (spec §5.4.6).
        return this.startFreshOnStandIn(thread.id, session, ahead, start, {
          said: said.skillCommand ? { id: randomUUID(), text: "" } : said,
          briefed: said.skillCommand ? place.brief.text : answer.briefed,
          ...(said.skillCommand && { commandAfterBrief: said }),
          place,
        });
      }
      const moved = ahead && (await this.carryToStandIn(thread.id, session, answer, ahead));
      if (!moved) return this.resume(thread, session, answer, start, said);
      return this.resumeOnStandIn(thread, moved, start, said);
    }
    return this.startNew(thread, session, answer, start);
  }

  /**
   * Starts `session`, the Thread's new one, on its Brief (`opening.briefed`), the skill command
   * after it when there is one; the session it replaces is forgotten once it runs.
   */
  private async startNew(
    thread: Thread,
    session: ThreadSession,
    answer: SessionStart,
    start: SessionStartWatch,
  ): Promise<void> {
    const { said, briefed, commandAfterBrief, role, replaced, place } = answer;
    let opened: EngineSession;
    let brief: UserMessage;
    try {
      start.at("preparing skills");
      const skills = await this.sessionSkills.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        project: place.project,
      });
      start.at("preparing MCP servers");
      const servers = await this.sessionMcpServers.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        projectId: place.project?.id,
        workingFolder: place.folder,
      });
      start.at("starting on the engine");
      // A new session takes the message's images with the Brief its text is in.
      brief = {
        id: said.id,
        text: withLeftOutServers(briefed, servers.leftOut),
        ...(said.images && { images: said.images }),
      };
      opened = await this.engine.start({
        id: session.id,
        settings: this.settingsOf(
          thread,
          session,
          answer,
          { skills, mcpServers: servers.servers },
          place,
        ),
        brief,
      });
    } catch (error) {
      await this.forget(session.id);
      throw error;
    }
    if (answer.gaveWay !== undefined) {
      await this.log(thread.id, [
        {
          kind: "model-gave-way",
          personName: role.card.name,
          model: answer.model,
          engineName: await this.engine.nameOf(session.engineId),
          notOffered: answer.gaveWay,
        },
      ]);
    }
    start.at("waiting for the engine's first event");
    this.watch(thread, answer, opened, start, brief, brief.id);
    if (commandAfterBrief) {
      // Its own turn after the Brief's, which keeps the Thread answering until it lands.
      opened.send(commandAfterBrief, "later");
      this.bargeIns.get(thread.id)?.sentAfterTurn(commandAfterBrief.id);
    }
    this.bargeIns.get(thread.id)?.turnStarted();
    // Only once the new session runs: until then the Thread may go back to the one it replaces.
    if (replaced) {
      await this.forget(replaced.id);
      await this.subAgentsAndProcesses.removeSession(replaced.id);
    }
  }

  /** Resumes the Thread's session on the engine it records, on `said`. */
  private async resume(
    thread: Thread,
    session: ThreadSession,
    reopening: Reopening,
    start: SessionStartWatch,
    said: UserMessage,
  ): Promise<void> {
    start.at("preparing skills");
    const skills = await this.sessionSkills.rebuild(session.id);
    start.at("preparing MCP servers");
    const servers = await this.sessionMcpServers.rebuild(session.id, reopening.place.folder);
    start.at("starting on the engine");
    const opened = await this.engine.resume(
      session.id,
      this.settingsOf(
        thread,
        session,
        reopening,
        { skills, mcpServers: servers.servers },
        reopening.place,
      ),
    );
    start.at("waiting for the engine's first event");
    // A skill command goes as written: the left-out servers wait for the next message.
    const message = said.skillCommand
      ? said
      : { ...said, text: withLeftOutServers(said.text, servers.leftOut) };
    this.watch(thread, reopening, opened, start, message);
    opened.send(message, "later");
    this.bargeIns.get(thread.id)?.turnStarted();
  }

  /**
   * Carries the Thread's idle session to the Stand-in Engine `standIn` and records it there, with
   * the line naming the person who goes on (spec 5.4). Undefined when the copy failed, which
   * leaves the session where it was.
   */
  private async carryToStandIn(
    threadId: string,
    session: ThreadSession,
    reopening: Reopening,
    { standIn, ...why }: StandInAhead,
  ): Promise<StandInMove | undefined> {
    try {
      const carried = await carrySessionToEngine(this.carrying, threadId, session.id, {
        from: session.engineId,
        to: standIn,
        ...why,
        personName: reopening.role.card.name,
      });
      // The same engine type: the session goes on with the same model and settings.
      return {
        ...carried,
        reopening,
        back: { engineId: session.engineId, standInFor: session.standInFor },
      };
    } catch (error) {
      this.logger.warn(
        `Thread ${threadId}'s session wasn't carried to ${standIn}: ${messageOf(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Resumes a session carried to a Stand-in Engine there, on `said`. A failed resume moves it back
   * to the engine it left, where it is resumed later, and throws saying so.
   */
  private async resumeOnStandIn(
    thread: Thread,
    { session, reopening, fromName, toName, back }: StandInMove,
    start: SessionStartWatch,
    said: UserMessage,
  ): Promise<void> {
    try {
      await this.resume(thread, session, reopening, start, said);
    } catch (error) {
      await this.change(thread.id, (latest) =>
        moveSessionBack(latest, { from: session.engineId, to: back }, new Date()),
      );
      // The line logged as it moved said it went on there: the failure says it didn't.
      throw new Error(
        `The session didn't resume on ${toName}, so it stays on ${fromName}: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Starts the Thread fresh on `ahead.standIn`, a Stand-in Engine of another type than `old`'s, or
   * of one whose session can't be carried (spec §5.4.6): `old` is replaced by a new session there,
   * recorded with the `engine-switched` line saying it starts fresh, which opens on `opening`'s
   * Brief with the person's current card, the Office instructions now and their model and effort
   * for the stand-in's type. When it doesn't open, `old` is put back, to be resumed later, and it
   * throws saying so.
   */
  private async startFreshOnStandIn(
    threadId: string,
    old: ThreadSession,
    { standIn, window, resetsAt }: StandInAhead,
    start: SessionStartWatch,
    opening: Pick<SessionStart, "said" | "briefed" | "commandAfterBrief" | "place">,
    sessionId: string = randomUUID(),
  ): Promise<void> {
    const thread = await this.threadOf(threadId);
    const role = await this.personOf(thread);
    const office = await this.officeInstructions.current();
    const { place } = opening;
    const work = await this.engineCascade
      .onEngine(thread.roleKey, standIn, cascadeLocationOf(thread.home, place.project?.id))
      .catch(refusedWithoutEngine);
    const now = new Date();
    const fresh = freshSession(
      sessionId,
      {
        ...role,
        officeInstructionsVersion: office.version,
        engineId: standIn,
        changesAllowed: place.workstation,
        heldDuties: place.heldDuties,
        standInFor: undefined,
      },
      now,
    );
    const fromName = await this.engine.nameOf(old.engineId);
    const toName = await this.engine.nameOf(standIn);
    const moved = await this.change(threadId, (latest) =>
      startSessionFreshOnEngine(
        latest,
        {
          messageId: randomUUID(),
          from: old.engineId,
          to: standIn,
          fromName,
          toName,
          window,
          resetsAt,
          personName: role.card.name,
          fresh,
        },
        now,
      ),
    );
    if (!moved.session) throw new Error(`Thread ${threadId} has no session.`);
    try {
      await this.startNew(
        moved,
        moved.session,
        {
          ...opening,
          role,
          officeInstructions: office.text,
          model: work.model,
          effort: work.effort,
          ...(work.gaveWay !== undefined && { gaveWay: work.gaveWay }),
          replaced: old,
        },
        start,
      );
    } catch (error) {
      await this.change(threadId, (latest) =>
        putBackReplacedSession(latest, { sessionId, previous: old }, new Date()),
      );
      // The line logged as it switched said it went on there: the failure says it didn't.
      throw new Error(
        `The session didn't start fresh on ${toName}, so it stays on ${fromName}: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * The engine refused the turn running for a used-up usage window: when a Stand-in Engine of the
   * list that applies has room, of any engine type, the answer goes on there with the turn's
   * message sent again, and the user's messages it never took after it (spec §5.4.6). On one of
   * the same type the session is carried there and resumed; on another type, or one whose session
   * can't be carried, the Thread starts fresh there with the Brief. False, with the session where
   * it was, when there is none (as under an engine override, where no list applies) or the carry
   * failed: the refused turn's notice stays, and the user writes again after the reset.
   */
  private async goOnOnStandIn(
    threadId: string,
    live: LiveSession,
    { usedUpWindow, usage }: TurnEndedEvent,
    context: ContextUsage | undefined,
  ): Promise<boolean> {
    const thread = await this.repository.find(threadId);
    const session = thread?.session;
    const refused = live.turnMessage;
    if (!usedUpWindow || !thread || !session || !refused || live.handingOver) return false;
    // Under a new id: the carried transcript holds the refused message's, and the engine skips a
    // message whose id it already has, which would leave the Thread answering with no turn running.
    const sentAgain = { ...refused, id: randomUUID() };
    // The list that applies now, not as the session opened: an engine override or a Project's own
    // list turned on or changed since counts, as a session goes on across messages.
    const applying = await this.engineCascade.applying(
      thread.roleKey,
      cascadeLocationOf(thread.home, live.reopening.place.project?.id),
    );
    const standIn = await this.engine.standInFor(session.engineId, {
      standIns: applying?.standIns.engineIds ?? [],
      needs: needsOf(live.reopening.place),
    });
    if (!standIn) return false;
    const ahead = { standIn, window: usedUpWindow.window, resetsAt: usedUpWindow.resetsAt };
    const carried = await this.carries(session.engineId, standIn);
    // Nothing may write the session's transcript while it is copied.
    await this.endLive(threadId);
    const moved = carried
      ? await this.carryToStandIn(threadId, session, live.reopening, ahead)
      : undefined;
    if (carried && !moved) return false;
    await this.change(threadId, (latest) =>
      endTurn(latest, {
        usage,
        contextTokens: context?.tokens ?? 0,
        contextWindow: context?.window,
        handingOver: false,
        turnFollows: true,
        endedAt: new Date(),
      }),
    );
    this.bargeIns.get(threadId)?.sessionReplaced();
    const freshId = randomUUID();
    const start = new SessionStartWatch(
      {
        threadId,
        sessionId: moved?.session.id ?? freshId,
        engineId: standIn,
        personName: live.reopening.role.card.name,
        move: moved ? "resume" : "start",
      },
      this.schedule,
      this.logger,
    );
    // Once this session's events are read to their end, as its turn's end is read now.
    void live.reading
      .then(async () => {
        if (moved) {
          return this.resumeOnStandIn(await this.threadOf(threadId), moved, start, sentAgain);
        }
        // The refused message goes again after the fresh Brief, or whole when it was the Brief. The
        // Brief reads the log up to it: it and the messages it never took are sent again.
        const place = await this.places.of(await this.threadOf(threadId), refused.id);
        const briefed =
          refused.id === live.briefId
            ? refused.text
            : briefedMessage(place.brief.text, refused.text, undefined);
        return this.startFreshOnStandIn(
          threadId,
          session,
          ahead,
          start,
          { said: sentAgain, briefed, place },
          freshId,
        );
      })
      .catch((error: unknown) => this.fail(threadId, error, { logged: start.failed(error) }));
    return true;
  }

  /** What carries a session to a Stand-in Engine. */
  private get carrying(): SessionCarrying {
    return { engine: this.engine, change: (threadId, change) => this.change(threadId, change) };
  }

  private settingsOf(
    thread: Thread,
    { id, engineId }: ThreadSession,
    {
      role: { roleKey, card, hardSwitches, mcpToolDefault },
      officeInstructions,
      model,
      effort,
    }: Pick<Answer, "role" | "officeInstructions" | "model" | "effort">,
    { skills, mcpServers }: Pick<SessionSettings, "skills" | "mcpServers">,
    place: SessionPlace,
  ): SessionSettings {
    return {
      engineId,
      model,
      folder: place.folder,
      readableFolders: place.readableFolders,
      environment: place.environment,
      effort: effort ?? undefined,
      instructions: place.instructions({ card, officeInstructions }),
      skills: skills && {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        userOnly: skills.userOnly,
        overrides: skills.overrides,
      },
      // Only reads (spec §6): the card's profile, narrowed, but in the Caretaker's Thread with
      // changes allowed. Its MCP tools keep their settings; one waiting on approval is refused in a
      // chat, which opens no Decision (`HeldCalls`).
      profile: {
        edit: place.workstation,
        run: { kind: place.workstation ? "anything" : "read-only-git" },
        web: place.workstation || card.permissionProfile.web,
        mcpTools: mcpToolSettingsFor(card.permissionProfile.mcpTools, mcpServers, mcpToolDefault),
      },
      workstation: place.workstation,
      readsEngineTranscripts: place.readsEngineTranscripts,
      refusalAdvice: place.refusalAdvice,
      officeTools: sessionOfficeTools(
        place.officeTools,
        { card, hardSwitches },
        place.callsCanWait,
        // A Consultation on a Task changes Project settings as an Agent Stage does (spec §6).
        thread.consultation !== undefined && thread.home.kind === "task",
      ),
      mcpServers,
      outputSchema: undefined,
      // Asked at each call, so an alarm sounding or lifted mid-session holds or frees the next.
      toolHold: () => this.fireAlarmLifts.heldReason(thread.id),
      approvalHold: this.approvalHolds.of(id),
      turnLabel: `${card.name} in ${threadWords(thread)}`,
      telemetry: threadTelemetry(thread, roleKey, place),
    };
  }

  /**
   * Reads the session's events into the log until it ends. It is started on `turnMessage`, so its
   * first turn runs; `start` hears of its first event.
   */
  private watch(
    thread: Thread,
    reopening: Reopening,
    session: EngineSession,
    start: SessionStartWatch,
    turnMessage: UserMessage,
    briefId?: string,
  ): void {
    const { roleKey, card } = reopening.role;
    const { folder, mask, officeTools } = reopening.place;
    const { id: threadId, home } = thread;
    const following = this.subAgentsAndProcesses.follow({
      threadId,
      home,
      sessionId: session.id,
      folder,
      mask,
      subAgentsLabel: `${card.name}'s Sub-agents in ${threadWords(thread)}`,
    });
    const live: LiveSession = {
      session,
      roleKey,
      folder,
      mask,
      officeTools,
      handingOver: false,
      turnRunning: true,
      idle: undefined,
      ending: false,
      following,
      reopening,
      turnMessage,
      briefId,
      reading: Promise.resolve(),
    };
    following.whenBackgroundSubAgentsEnd(() => {
      if (!live.turnRunning) this.idleFrom(threadId, live);
    });
    this.live.set(threadId, live);
    live.reading = this.read(threadId, live, start)
      .then(() => (live.ending ? undefined : this.endedEarly(threadId, session.id)))
      .catch((error: unknown) => this.fail(threadId, error, { logged: start.failed(error) }))
      .finally(() => {
        start.ended();
        if (live.idle) clearTimeout(live.idle);
        if (this.live.get(threadId) === live) this.live.delete(threadId);
      });
  }

  /** The session stopped of its own accord: a Thread it was answering waits for the user again. */
  private async endedEarly(threadId: string, sessionId: string): Promise<void> {
    const thread = await this.threadOf(threadId);
    if (thread.state === "answering" && thread.session?.id === sessionId) {
      await this.change(threadId, (latest) =>
        failAnswer(latest, "The session ended before the answer was finished.", new Date()),
      );
      await this.endBargeIns(threadId);
    }
  }

  private async read(threadId: string, live: LiveSession, start: SessionStartWatch): Promise<void> {
    try {
      for await (const event of live.session.events) {
        start.spoke();
        await this.readEvent(threadId, live, event);
      }
    } finally {
      await live.following.end();
    }
  }

  private async readEvent(threadId: string, live: LiveSession, event: SessionEvent): Promise<void> {
    await live.following.take(event);
    // A turn the engine began itself, such as on a background Sub-agent's report.
    if (isAgentsOwnTurnEvent(event)) this.turnBegan(live);
    if (event.kind === "turn-ended") {
      await this.turnEnded(threadId, live, event);
      return;
    }
    if (event.kind === "turn-tokens") {
      await this.change(threadId, (thread) => countRunningTurn(thread, event.soFar, new Date()));
      return;
    }
    if (event.kind === "context-read") {
      await this.change(threadId, (thread) => readRunningContext(thread, event.tokens, new Date()));
      return;
    }
    const lines = sessionLogLines(event, live);
    if (lines.length > 0) await this.log(threadId, lines);
  }

  private async turnEnded(
    threadId: string,
    live: LiveSession,
    turn: TurnEndedEvent,
  ): Promise<void> {
    if (turn.outcome === "failed") {
      await this.log(threadId, [
        { kind: "failure", reason: turn.errors.join(" ") || "The engine ended the turn." },
      ]);
    }
    // Read before a switch to a Stand-in Engine ends the session.
    const usage = await this.contextUsageOf(threadId, live);
    if (turn.outcome === "usage-window-used-up" && turn.usedUpWindow) {
      if (await this.goOnOnStandIn(threadId, live, turn, usage)) return;
      // No failure: the user writes again once the window resets (spec 2.4).
      const engineId = (await this.repository.find(threadId))?.session?.engineId;
      await this.log(threadId, [
        {
          kind: "usage-window-used-up",
          engineName: engineId === undefined ? "The engine" : await this.engine.nameOf(engineId),
          window: turn.usedUpWindow.window,
          resetsAt: turn.usedUpWindow.resetsAt.toISOString(),
        },
      ]);
    }
    const stillToLand = await this.landBargeIns(threadId, turn);
    if (!stillToLand) live.turnRunning = false;
    const wroteNote = live.handingOver;
    // A session ended for a switch to a Stand-in Engine whose carry failed takes nothing more.
    const ended = live.ending;
    const handingOver =
      !ended &&
      !stillToLand &&
      !wroteNote &&
      usage !== undefined &&
      usage.tokens >= usage.window * DEFAULT_CONTEXT_POLICY_SETTINGS.handOverAtShare;
    await this.change(threadId, (thread) =>
      endTurn(thread, {
        usage: turn.usage,
        contextTokens: usage?.tokens ?? 0,
        contextWindow: usage?.window,
        handingOver,
        turnFollows: stillToLand,
        endedAt: new Date(),
      }),
    );
    // The engine starts the next turn with the user's messages, which is read as this one was.
    if (stillToLand) return;
    if (handingOver) {
      const request = handoverRequest(await this.promptTemplates.textsOf([HANDOVER_REQUEST]));
      live.handingOver = true;
      this.turnBegan(live);
      live.turnMessage = { id: randomUUID(), text: request };
      live.session.send(live.turnMessage, "later");
      return;
    }
    if (wroteNote) {
      await this.endLive(threadId);
      return;
    }
    if (!ended) this.idleFrom(threadId, live);
    // Not awaited: the session's events are read on while the answers go to it.
    void this.deliverWaitingAnswers(threadId).catch((error: unknown) => {
      this.logger.error(
        `Thread ${threadId}'s waiting answers weren't handed over: ${messageOf(error)}`,
      );
    });
  }

  /**
   * Marks the user's messages the turn took as delivered; the answer's messages end with it unless
   * some sent are still to land, which the function answers.
   */
  private async landBargeIns(threadId: string, turn: TurnEndedEvent): Promise<boolean> {
    const bargeIns = this.bargeIns.get(threadId);
    if (!bargeIns) return false;
    const { delivered, stillToLand } = bargeIns.turnEnded(
      turn.consumedMessageIds,
      turn.outcome === "completed",
    );
    // Ended at once, so a message written from now on is refused rather than held.
    const undelivered = stillToLand ? [] : this.closeBargeIns(threadId);
    await this.mark(threadId, delivered, "delivered");
    await this.mark(threadId, undelivered, "not-delivered");
    return stillToLand;
  }

  /** The answer has ended: the user's messages to it that never landed are marked so. */
  private async endBargeIns(threadId: string): Promise<void> {
    await this.mark(threadId, this.closeBargeIns(threadId), "not-delivered");
  }

  /** Ends the answer's messages, answering those that never landed. */
  private closeBargeIns(threadId: string): readonly string[] {
    const bargeIns = this.bargeIns.get(threadId);
    this.bargeIns.delete(threadId);
    return bargeIns?.end() ?? [];
  }

  private async mark(
    threadId: string,
    messageIds: readonly string[],
    delivery: MessageDelivery,
  ): Promise<void> {
    await this.change(threadId, (thread) =>
      markDelivery(thread, { messageIds, delivery }, new Date()),
    );
  }

  private turnBegan(live: LiveSession): void {
    live.turnRunning = true;
    if (live.idle) clearTimeout(live.idle);
    live.idle = undefined;
  }

  /**
   * Ends the session once it has been idle for `IDLE_MS`, unless its background Sub-agents still
   * run then: the last one's end starts the wait again (spec 2.9).
   */
  private idleFrom(threadId: string, live: LiveSession): void {
    if (live.idle) clearTimeout(live.idle);
    live.idle = setTimeout(() => {
      live.idle = undefined;
      if (!live.following.backgroundSubAgentsRunning) void this.endLive(threadId);
    }, IDLE_MS);
    live.idle.unref();
  }

  /** The session's context as its turn ended; undefined when its engine can't report it. */
  private async contextUsageOf(
    threadId: string,
    live: LiveSession,
  ): Promise<ContextUsage | undefined> {
    const engineId = (await this.repository.find(threadId))?.session?.engineId;
    if (engineId === undefined || !(await this.engine.reportsContext(engineId))) return undefined;
    return live.session.readContextUsage();
  }

  private async endLive(threadId: string): Promise<void> {
    const live = this.live.get(threadId);
    if (!live) return;
    this.live.delete(threadId);
    live.ending = true;
    if (live.idle) clearTimeout(live.idle);
    const ending = live.session.end().catch((error: unknown) => {
      this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
    });
    this.endings.set(threadId, ending);
    await ending;
    if (this.endings.get(threadId) === ending) this.endings.delete(threadId);
  }

  /**
   * A session that won't be resumed: its skills folder and its MCP servers' record go, and a
   * failure there only warns.
   */
  private async forget(sessionId: string): Promise<void> {
    await this.sessionSkills.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s skills stay: ${messageOf(error)}`);
    });
    await this.sessionMcpServers.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s MCP servers stay recorded: ${messageOf(error)}`);
    });
  }

  /**
   * The person couldn't answer: why goes into the log, and the Thread waits for the user. A
   * Decision whose answer never reached a session waits on the user again.
   */
  private async fail(
    threadId: string,
    error: unknown,
    {
      unopened,
      answers,
      logged = false,
    }: {
      readonly unopened?: UnopenedSession;
      readonly answers?: readonly Decision[];
      /** The service log has the failure already, as a session's opening logs its own. */
      readonly logged?: boolean;
    } = {},
  ): Promise<void> {
    if (!logged) this.logger.error(`Thread ${threadId} stopped answering: ${messageOf(error)}`);
    await this.endLive(threadId);
    const reason = messageOf(error);
    const [first, ...others] = answers ?? [];
    try {
      await this.endBargeIns(threadId);
      await this.change<DecisionReopened | MessagesLogged>(threadId, (thread) =>
        first
          ? failDecisionAnswer(thread, first, reason, new Date(), unopened)
          : failAnswer(thread, reason, new Date(), unopened),
      );
      for (const decision of others) {
        await this.change(threadId, (thread) => reopenDecision(thread, decision, new Date()));
      }
    } catch (failure) {
      this.logger.error(`Thread ${threadId}'s failure wasn't logged: ${messageOf(failure)}`);
    }
  }

  private async log(threadId: string, drafts: readonly MessageDraft[]): Promise<void> {
    const at = new Date();
    const messages = drafts.map((draft): Message => ({ ...draft, id: randomUUID(), threadId, at }));
    await this.change(threadId, (thread) => logMessages(thread, messages, at));
  }

  private async change<Event extends DomainEvent>(
    threadId: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<Thread> {
    const { thread, event } = await this.repository.update(threadId, change);
    if (event) await this.events.publish(event);
    return thread;
  }

  private async threadOf(threadId: string): Promise<Thread> {
    const thread = await this.repository.find(threadId);
    if (!thread) throw new ThreadNotFound(threadId);
    return thread;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the engine calls of a Thread's session carry (spec §5.2): its home's ids, the Thread's and
 * the person's Role on the span; on the metric only names, the Stage `""` as no Stage runs here.
 */
export function threadTelemetry(
  thread: Pick<Thread, "id" | "home">,
  roleKey: string,
  { span, metric }: Pick<SessionPlace, "span" | "metric">,
): NonNullable<SessionSettings["telemetry"]> {
  return {
    span: { ...span, "office.thread": thread.id, "office.role": roleKey },
    metric: {
      "office.conversation.home": thread.home.kind,
      "office.role": roleKey,
      "office.stage": "",
      ...metric,
    },
  };
}

/** What a Stand-in Engine must have to run the Thread's session: Office tools when it has some. */
function needsOf(place: Pick<SessionPlace, "officeTools">): readonly EngineCapability[] {
  return place.officeTools.length > 0 ? ["officeTools"] : [];
}

/** No engine listed refuses the message in words, before anything is logged. */
function refusedWithoutEngine(error: unknown): never {
  if (error instanceof NoEngineListed) throw new ThreadRefused([error.message]);
  throw error;
}

/**
 * Which Thread, as a scheduled Office update lists the work it waits for there, such as `an
 * Initiative's Thread, "Planning"`.
 */
function threadWords(thread: Thread): string {
  if (thread.consultation) return "a Consultation";
  const where = HOME_WORDS[thread.home.kind];
  return thread.title ? `${where}, "${thread.title}"` : where;
}

const HOME_WORDS: Readonly<Record<Thread["home"]["kind"], string>> = {
  chat: "a chat",
  task: "a Task's Thread",
  initiative: "an Initiative's Thread",
};

/** An event of the Agent's own turn: never a Sub-agent's or a Process's, which run between turns too. */
function isAgentsOwnTurnEvent(event: SessionEvent): boolean {
  switch (event.kind) {
    case "turn-tokens":
    case "context-read":
      return true;
    case "text":
    case "tool-call":
      return event.withinToolCall === undefined;
    default:
      return false;
  }
}

/** The texts given, in order, a blank line between them. */
function inOrder(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join("\n\n");
}
