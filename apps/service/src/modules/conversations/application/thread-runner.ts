import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { EngineSessions, NoEngineListed } from "../../engine/index.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import {
  EngineCascade,
  mcpToolSettingsFor,
  RoleCards,
  type SessionRole,
} from "../../people/index.js";
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
} from "../domain/decision.js";
import {
  briefBeforeSkillCommand,
  briefedMessage,
  decisionAnswerMessage,
  decisionAnswersOnTasksMessage,
  HANDOVER_REQUEST,
  messageFromUser,
  openingMessage,
  sessionOfficeTools,
  withLeftOutServers,
} from "../domain/session-instructions.js";
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
  latestWriter,
  type Message,
  type MessageDelivery,
  type MessageDraft,
  type MessageImage,
} from "../domain/message.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
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
  openDecisionOf,
  readRunningContext,
  reopenDecision,
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
  /** The model the engine cascade gives now, which a resumed session takes too. */
  readonly model: string;
  /** The session the move replaces, which can't be resumed any more. */
  readonly replaced: ThreadSession | undefined;
  readonly place: SessionPlace;
  /** The Decisions the message answers, which open again if the answers never reach a session. */
  readonly answers: readonly Decision[];
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
    const given: GivenRecords = {
      mentioned: await this.mentionedRecords.read(mentions),
      openPage: ofBrief && (await this.mentionedRecords.openPage(ofBrief)),
      ofRunningSession: () => this.openPageOfRunningSession(threadId, openPage, mentions),
    };
    return this.take(
      thread,
      current,
      { id: said.id, text, writtenBy, skillCommandAmong: sent.skillCommandAmong, images },
      (latest, opening, command) =>
        beginAnswer(latest, {
          ...opening,
          said: command ? { ...said, skillCommand: { skill: command.name } } : said,
        }),
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
   * Answers one of the Thread's open Decisions and has the person take the answer, with its
   * question, as their next message, under the Context policy as any message is, together with any
   * answers that waited for it. In an Initiative's planning Thread an answer given while the person
   * is answering is kept for their turn's end instead (spec §2.4). `answerer` is who answered: a
   * user, a Consultant or a person at the user's request. Refused once it is answered, with an
   * answer that isn't one, and in a Thread on a Task while the person is still answering.
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
   * end of that turn hands them over.
   */
  private async deliverWaitingAnswers(threadId: string): Promise<void> {
    const thread = await this.threadOf(threadId);
    if (thread.home.kind !== "initiative" || thread.state !== "waiting") return;
    const waiting = await this.waitingAnswers(thread);
    if (waiting.length === 0) return;
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
    const onTasks = await Promise.all(
      given.map(async (answer) => ({
        ...answer,
        taskTitle:
          answer.decision.taskId === undefined
            ? undefined
            : await this.work.taskTitle(answer.decision.taskId),
        answerer: await this.answererOf(answer.answer),
      })),
    );
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
      said: { id: said.id, text: newSession ? said.text : withRecords, ...images },
      briefed: briefedMessage(place.brief.text, said.text, said.writtenBy),
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
    await Promise.all(
      threads
        .filter(({ state }) => state === "waiting")
        .map(async ({ id }) => {
          await this.endLive(id);
          await this.endings.get(id);
        }),
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
   * model it runs on: the engine cascade's for the Thread's Project, where it has one. A resumed
   * session keeps its engine, card version and Office instructions; a changed engine starts the
   * Thread fresh.
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
    readonly newSession: ThreadSession | undefined;
  }> {
    const applying = await this.engineCascade
      .of(thread.roleKey, place.project?.id)
      .catch(refusedWithoutEngine);
    const decision = decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: current.card.sessionDefault,
        engineId: applying.engineId,
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
    const newSession = resumed
      ? undefined
      : freshSession(
          randomUUID(),
          {
            ...current,
            officeInstructionsVersion: office.version,
            engineId: applying.engineId,
            changesAllowed: place.workstation,
            heldDuties: place.heldDuties,
          },
          now,
        );
    return {
      decision,
      role,
      officeInstructions: office.text,
      model: applying.model,
      newSession,
    };
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
    if (decision.move === "resume" && live?.session.id === session.id && sameTools) {
      this.turnBegan(live);
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

  /** Opens the Thread's session on `said`, once the one running before it has ended. */
  private async openSession(
    thread: Thread,
    session: ThreadSession,
    {
      said,
      briefed,
      commandAfterBrief,
      decision,
      role,
      officeInstructions,
      model,
      replaced,
      place,
    }: Answer,
    start: SessionStartWatch,
  ): Promise<void> {
    await this.endLive(thread.id);
    await this.endings.get(thread.id);
    start.at("refreshing the Thread's folders");
    await place.ready();
    if (decision.move === "resume") {
      start.at("preparing skills");
      const skills = await this.sessionSkills.rebuild(session.id);
      start.at("preparing MCP servers");
      const servers = await this.sessionMcpServers.rebuild(session.id, place.folder);
      start.at("starting on the engine");
      const opened = await this.engine.resume(
        session.id,
        this.settingsOf(
          thread,
          session,
          { role, officeInstructions, model },
          { skills, mcpServers: servers.servers },
          place,
        ),
      );
      start.at("waiting for the engine's first event");
      this.watch(thread, role, place, opened, start);
      // A skill command goes as written: the left-out servers wait for the next message.
      opened.send(
        said.skillCommand
          ? said
          : { ...said, text: withLeftOutServers(said.text, servers.leftOut) },
        "later",
      );
      this.bargeIns.get(thread.id)?.turnStarted();
      return;
    }
    let opened: EngineSession;
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
      opened = await this.engine.start({
        id: session.id,
        settings: this.settingsOf(
          thread,
          session,
          { role, officeInstructions, model },
          { skills, mcpServers: servers.servers },
          place,
        ),
        // A new session takes the message's images with the Brief its text is in.
        brief: {
          id: said.id,
          text: withLeftOutServers(briefed, servers.leftOut),
          ...(said.images && { images: said.images }),
        },
      });
    } catch (error) {
      await this.forget(session.id);
      throw error;
    }
    start.at("waiting for the engine's first event");
    this.watch(thread, role, place, opened, start);
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

  private settingsOf(
    thread: Thread,
    { id, engineId }: ThreadSession,
    {
      role: { roleKey, card, mcpToolDefault },
      officeInstructions,
      model,
    }: Pick<Answer, "role" | "officeInstructions" | "model">,
    { skills, mcpServers }: Pick<SessionSettings, "skills" | "mcpServers">,
    place: SessionPlace,
  ): SessionSettings {
    return {
      engineId,
      model,
      folder: place.folder,
      readableFolders: place.readableFolders,
      environment: place.environment,
      effort: card.effort,
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
      officeTools: sessionOfficeTools(place.officeTools, card, place.callsCanWait),
      mcpServers,
      outputSchema: undefined,
      // Asked at each call, so an alarm sounding or lifted mid-session holds or frees the next.
      toolHold: () => this.fireAlarmLifts.heldReason(thread.id),
      approvalHold: this.approvalHolds.of(id),
      turnLabel: `${card.name} in ${threadWords(thread)}`,
      telemetry: {
        span: { ...place.span, "office.thread": thread.id, "office.role": roleKey },
        metric: { "office.conversation.home": thread.home.kind },
      },
    };
  }

  /**
   * Reads the session's events into the log until it ends. It is started on a message, so its
   * first turn runs; `start` hears of its first event.
   */
  private watch(
    thread: Thread,
    { roleKey, card }: SessionRole,
    { folder, mask, officeTools }: Pick<SessionPlace, "folder" | "mask" | "officeTools">,
    session: EngineSession,
    start: SessionStartWatch,
  ): void {
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
    };
    following.whenBackgroundSubAgentsEnd(() => {
      if (!live.turnRunning) this.idleFrom(threadId, live);
    });
    this.live.set(threadId, live);
    void this.read(threadId, live, start)
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
    // No failure: the user writes again once the window resets (spec 2.4).
    if (turn.outcome === "usage-window-used-up" && turn.usedUpWindow) {
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
    const usage = await this.contextUsageOf(threadId, live);
    const wroteNote = live.handingOver;
    const handingOver =
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
      live.handingOver = true;
      this.turnBegan(live);
      live.session.send({ id: randomUUID(), text: HANDOVER_REQUEST }, "later");
      return;
    }
    if (wroteNote) {
      await this.endLive(threadId);
      return;
    }
    this.idleFrom(threadId, live);
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
