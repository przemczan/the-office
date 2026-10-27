import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineSessions } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import { answerProblems, type Decision, type DecisionAnswer } from "../domain/decision.js";
import {
  briefedMessage,
  decisionAnswerMessage,
  HANDOVER_REQUEST,
  openingMessage,
  sessionOfficeTools,
} from "../domain/session-instructions.js";
import {
  DEFAULT_CONTEXT_POLICY_SETTINGS,
  decideContext,
  type ContextDecision,
} from "../domain/context-policy.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { DecisionReopened, MessagesLogged } from "../domain/conversation-events.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
import {
  answerDecision,
  beginAnswer,
  beginOpening,
  countRunningTurn,
  endTurn,
  failAnswer,
  failDecisionAnswer,
  freshSession,
  logMessages,
  type Opening,
  type ThreadChange,
  type UnopenedSession,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { sessionLogLines } from "./session-log.js";
import { SessionPlaces, type SessionPlace } from "./session-places.js";
import { StageThreads } from "./stage-threads.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];
type SessionEvent = EngineSession["events"] extends AsyncIterable<infer Event> ? Event : never;
type TurnEndedEvent = Extract<SessionEvent, { kind: "turn-ended" }>;

/** How long a session's process stays up after its last turn, waiting for the next message. */
const IDLE_MS = 10 * 60 * 1000;

/** A message the person answers, and where and with what the session that answers it runs. */
interface Answer {
  /** What a resumed session is sent, by the id its turn names it by. */
  readonly said: { readonly id: string; readonly text: string };
  /** What a new session is started with: the Brief, then `said`. */
  readonly briefed: string;
  readonly decision: ContextDecision;
  readonly role: SessionRole;
  /** The session the move replaces, which can't be resumed any more. */
  readonly replaced: ThreadSession | undefined;
  readonly place: SessionPlace;
  /** The Decision the message answers, which opens again if the answer never reaches a session. */
  readonly answers: Decision | undefined;
}

/** A session running behind a Thread, read by one loop that logs what it reports. */
interface LiveSession {
  readonly session: EngineSession;
  /** Whose session it is, as the log names them. */
  readonly roleKey: string;
  /** Where it works, which its tool calls are summed up against. */
  readonly folder: string;
  /** The person writes their Handover note in the turn running now; the session ends after it. */
  handingOver: boolean;
  idle: NodeJS.Timeout | undefined;
  /** The Office ends it: its events finishing then is no surprise. */
  ending: boolean;
}

/**
 * Runs Threads (spec §2.4, §2.5): each message the user sends goes through the Context policy,
 * which resumes the Thread's session, or starts a fresh one with a Brief; what the session reports
 * goes into The Office's log as it comes. Where a session works is its home's (SessionPlaces); in
 * every home it reads and changes no file: a chat and a Task's planning only read (spec §6).
 */
@Injectable()
export class ThreadRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadRunner.name);
  private readonly live = new Map<string, LiveSession>();
  /** Sessions still ending, by Thread: a resume of one waits until its process is gone. */
  private readonly endings = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly places: SessionPlaces,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly stageThreads: StageThreads,
    private readonly events: EventBus,
    private readonly settings: ContextPolicySettingsService,
  ) {}

  /**
   * Logs the user's message and has the person answer it; the answer comes into the log as it is
   * written. Into a Stage Thread while its Stage runs, the message lands at the next safe point
   * instead (barge-in). Refused while the person is still answering anywhere else, when nobody
   * fills their Role any more, or in a chat, when their Chat is off.
   */
  async send(threadId: string, text: string): Promise<Thread> {
    const thread = await this.threadOf(threadId);
    if (thread.stageThread && thread.state === "answering") {
      return this.stageThreads.bargeIn(threadId, text);
    }
    const current = await this.personOf(thread);
    if (text.trim() === "") throw new ThreadRefused(["Write a message first."]);
    const said: Message = {
      kind: "user",
      id: randomUUID(),
      threadId,
      text,
      delivery: "delivered",
      at: new Date(),
    };
    return this.take(thread, current, { id: said.id, text }, (latest, opening) =>
      beginAnswer(latest, { ...opening, said }),
    );
  }

  /**
   * Answers the Thread's open Decision and has the person take the answer, with its question, as
   * their next message, under the Context policy as any message is. Refused once it is answered,
   * with an answer that isn't one, and while the person is still answering.
   */
  async answerDecision(
    threadId: string,
    decisionId: string,
    answer: DecisionAnswer,
  ): Promise<Thread> {
    const thread = await this.threadOf(threadId);
    const open = thread.openDecision;
    if (open?.id !== decisionId) throw new ThreadRefused(["This Decision is answered already."]);
    const problems = answerProblems(open, answer);
    if (problems.length > 0) throw new ThreadRefused(problems);
    const current = await this.personOf(thread);
    const said = { id: randomUUID(), text: decisionAnswerMessage(open, answer) };
    // Briefed as the Thread will be once answered: the message, not the Brief, carries this one.
    const answered = { ...thread, openDecision: undefined };
    return this.take(
      answered,
      current,
      said,
      (latest, opening) =>
        answerDecision(latest, {
          ...opening,
          decisionId,
          answer,
          messageId: said.id,
          answeredAt: new Date(),
        }),
      open,
    );
  }

  /**
   * Has the person start on a Thread The Office opened, such as a Task's planning Thread: a new
   * session, given the Brief and `opening`, answers before the user has said anything.
   */
  async open(threadId: string, opening: string): Promise<Thread> {
    const now = new Date();
    const thread = await this.threadOf(threadId);
    const current = await this.personOf(thread);
    const place = await this.places.of(thread);
    const { decision, role, newSession } = await this.moveFor(thread, current, place, now);
    const answering = await this.change(threadId, (latest) =>
      beginOpening(
        latest,
        { personName: current.card.name, decision, newSession, brief: place.brief.text },
        now,
      ),
    );
    this.answerInBackground(answering, {
      said: { id: randomUUID(), text: opening },
      briefed: openingMessage(place.brief.text, opening),
      decision,
      role,
      replaced: undefined,
      place,
      answers: undefined,
    });
    return answering;
  }

  /**
   * The person takes `said` under the Context policy's move: `begin` logs it and sets the Thread
   * answering, and the session answers once the call that asked returns. `said` may answer a
   * Decision, which opens again when the session never starts.
   */
  private async take<Event extends DomainEvent>(
    thread: Thread,
    current: SessionRole,
    said: Answer["said"],
    begin: (latest: Thread, opening: Opening) => ThreadChange<Event>,
    answers?: Decision,
  ): Promise<Thread> {
    const place = await this.places.of(thread);
    const { decision, role, newSession } = await this.moveFor(thread, current, place, new Date());
    const answering = await this.change(thread.id, (latest) =>
      begin(latest, {
        personName: current.card.name,
        decision,
        newSession,
        brief: place.brief.text,
      }),
    );
    this.answerInBackground(answering, {
      said,
      briefed: briefedMessage(place.brief.text, said.text),
      decision,
      role,
      replaced: newSession ? thread.session : undefined,
      place,
      answers,
    });
    return answering;
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
    if (thread.home.kind === "task") {
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

  /** The Context policy's move for the Thread's next message, and the session it opens, if any. */
  private async moveFor(
    thread: Thread,
    current: SessionRole,
    place: SessionPlace,
    now: Date,
  ): Promise<{
    readonly decision: ContextDecision;
    readonly role: SessionRole;
    readonly newSession: ThreadSession | undefined;
  }> {
    const decision = decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: current.card.sessionDefault,
        override: thread.override,
        briefTokens: place.brief.tokens,
      },
      await this.settings.current(),
    );
    const resumed = decision.move === "resume" ? thread.session : undefined;
    const role = resumed
      ? await this.roleCards.forResumedSession(resumed.roleKey, resumed.cardVersion)
      : current;
    const newSession = resumed ? undefined : freshSession(randomUUID(), role, now);
    return { decision, role, newSession };
  }

  /**
   * The person answers once the call that asked returns; a failure goes into the log. Failing here,
   * the session never got the message: a Decision it answered waits on the user again.
   */
  private answerInBackground(thread: Thread, answer: Answer): void {
    const opening = answer.decision.move === "resume" ? undefined : thread.session;
    const unopened = opening && { sessionId: opening.id, previous: answer.replaced };
    void this.answer(thread, answer).catch((error: unknown) =>
      this.fail(thread.id, error, { unopened, answers: answer.answers }),
    );
  }

  private async answer(
    thread: Thread,
    { said, briefed, decision, role, replaced, place }: Answer,
  ): Promise<void> {
    const session = thread.session;
    if (!session) throw new Error(`Thread ${thread.id} answers with no session.`);
    const live = this.live.get(thread.id);
    if (decision.move === "resume" && live?.session.id === session.id) {
      if (live.idle) clearTimeout(live.idle);
      live.session.send(said, "later");
      return;
    }
    await this.endLive(thread.id);
    await this.endings.get(thread.id);
    await place.ready();
    if (decision.move === "resume") {
      const skills = await this.sessionSkills.rebuild(session.id);
      const opened = await this.engine.resume(
        session.id,
        this.settingsOf(thread, role, skills, place),
      );
      this.watch(thread.id, role.roleKey, place.folder, opened);
      opened.send(said, "later");
      return;
    }
    let opened: EngineSession;
    try {
      const skills = await this.sessionSkills.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        project: place.project,
      });
      opened = await this.engine.start({
        id: session.id,
        settings: this.settingsOf(thread, role, skills, place),
        brief: { id: said.id, text: briefed },
      });
    } catch (error) {
      await this.forget(session.id);
      throw error;
    }
    this.watch(thread.id, role.roleKey, place.folder, opened);
    // Only once the new session runs: until then the Thread may go back to the one it replaces.
    if (replaced) await this.forget(replaced.id);
  }

  private settingsOf(
    thread: Thread,
    { roleKey, card }: SessionRole,
    skills: SessionSettings["skills"],
    place: SessionPlace,
  ): SessionSettings {
    return {
      folder: place.folder,
      environment: place.environment,
      model: card.model,
      effort: card.effort,
      instructions: place.instructions(card),
      skills: skills && {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      // Only reads (spec §6): the card's profile, narrowed.
      profile: { edit: false, run: { kind: "read-only-git" }, web: card.permissionProfile.web },
      officeTools: sessionOfficeTools(place.officeTools, card, thread.home.kind === "task"),
      outputSchema: undefined,
      telemetry: {
        span: { ...place.span, "office.thread": thread.id, "office.role": roleKey },
        metric: { "office.conversation.home": thread.home.kind },
      },
    };
  }

  /** Reads the session's events into the log until it ends. */
  private watch(threadId: string, roleKey: string, folder: string, session: EngineSession): void {
    const live: LiveSession = {
      session,
      roleKey,
      folder,
      handingOver: false,
      idle: undefined,
      ending: false,
    };
    this.live.set(threadId, live);
    void this.read(threadId, live)
      .then(() => (live.ending ? undefined : this.endedEarly(threadId, session.id)))
      .catch((error: unknown) => this.fail(threadId, error))
      .finally(() => {
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
    }
  }

  private async read(threadId: string, live: LiveSession): Promise<void> {
    for await (const event of live.session.events) {
      if (event.kind === "turn-ended") {
        await this.turnEnded(threadId, live, event);
        continue;
      }
      if (event.kind === "turn-tokens") {
        await this.change(threadId, (thread) => countRunningTurn(thread, event.soFar, new Date()));
        continue;
      }
      const lines = sessionLogLines(event, live);
      if (lines.length > 0) await this.log(threadId, lines);
    }
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
    const usage = await live.session.readContextUsage();
    const wroteNote = live.handingOver;
    const handingOver =
      !wroteNote && usage.tokens >= usage.window * DEFAULT_CONTEXT_POLICY_SETTINGS.handOverAtShare;
    await this.change(threadId, (thread) =>
      endTurn(thread, {
        usage: turn.usage,
        contextTokens: usage.tokens,
        handingOver,
        officeSendsNext: false,
        endedAt: new Date(),
      }),
    );
    if (handingOver) {
      live.handingOver = true;
      live.session.send({ id: randomUUID(), text: HANDOVER_REQUEST }, "later");
      return;
    }
    if (wroteNote) {
      await this.endLive(threadId);
      return;
    }
    live.idle = setTimeout(() => void this.endLive(threadId), IDLE_MS);
    live.idle.unref();
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

  /** A session that won't be resumed: its skills folder goes, and a failure there only warns. */
  private async forget(sessionId: string): Promise<void> {
    await this.sessionSkills.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s skills stay: ${messageOf(error)}`);
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
    }: { readonly unopened?: UnopenedSession; readonly answers?: Decision | undefined } = {},
  ): Promise<void> {
    this.logger.error(`Thread ${threadId} stopped answering: ${messageOf(error)}`);
    await this.endLive(threadId);
    const reason = messageOf(error);
    await this.change<DecisionReopened | MessagesLogged>(threadId, (thread) =>
      answers
        ? failDecisionAnswer(thread, answers, reason, new Date(), unopened)
        : failAnswer(thread, reason, new Date(), unopened),
    ).catch((failure: unknown) => {
      this.logger.error(`Thread ${threadId}'s failure wasn't logged: ${messageOf(failure)}`);
    });
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
