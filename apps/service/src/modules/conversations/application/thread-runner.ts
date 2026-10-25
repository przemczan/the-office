import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineSessions } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import { briefedMessage, chatInstructions, HANDOVER_REQUEST } from "../domain/chat-instructions.js";
import {
  decideContext,
  type ContextDecision,
  type ContextPolicySettings,
} from "../domain/context-policy.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
import {
  beginAnswer,
  endTurn,
  failAnswer,
  logMessages,
  type ThreadChange,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { toolActivitySummary } from "../domain/tool-activity.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { CONTEXT_POLICY_SETTINGS } from "./thread-contexts.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];
type SessionEvent = EngineSession["events"] extends AsyncIterable<infer Event> ? Event : never;
type TurnEndedEvent = Extract<SessionEvent, { kind: "turn-ended" }>;

/** How long a session's process stays up after its last turn, waiting for the next message. */
const IDLE_MS = 10 * 60 * 1000;

/** A session running behind a Thread, read by one loop that logs what it reports. */
interface LiveSession {
  readonly session: EngineSession;
  /** Whose session it is, as the log names them. */
  readonly roleKey: string;
  /** The person writes their Handover note in the turn running now; the session ends after it. */
  handingOver: boolean;
  idle: NodeJS.Timeout | undefined;
}

/**
 * Runs Threads (spec §2.4, §2.5): each message the user sends goes through the Context policy,
 * which resumes the Thread's session, or starts a fresh one with a Brief; what the session reports
 * goes into The Office's log as it comes. A chat session reads every Project's base branch and
 * changes nothing (spec §6).
 */
@Injectable()
export class ThreadRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadRunner.name);
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly briefs: Briefs,
    private readonly bases: ProjectBases,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly events: EventBus,
    @Inject(CONTEXT_POLICY_SETTINGS) private readonly settings: ContextPolicySettings,
  ) {}

  /**
   * Logs the user's message and has the person answer it; the answer comes into the log as it is
   * written. Refused while the person is still answering, or when their Chat is off.
   */
  async send(threadId: string, text: string): Promise<Thread> {
    const now = new Date();
    const thread = await this.threadOf(threadId);
    const current = await this.roleCards.find(thread.roleKey);
    if (!current) throw new ChatNotFound(thread.roleKey);
    if (!current.card.capabilities.chat) {
      throw new ThreadRefused([
        `Chat is off for ${current.card.name}: their Threads stay readable, and they answer on Tasks. Turn Chat on on their Role card to continue here.`,
      ]);
    }
    if (text.trim() === "") throw new ThreadRefused(["Write a message first."]);
    const brief = await this.briefs.forChatThread(thread);
    const decision = decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: current.card.sessionDefault,
        override: thread.override,
        briefTokens: brief.tokens,
      },
      this.settings,
    );
    const resumed = decision.move === "resume" ? thread.session : undefined;
    const role = resumed
      ? await this.roleCards.forResumedSession(resumed.roleKey, resumed.cardVersion)
      : current;
    const newSession: ThreadSession | undefined = resumed
      ? undefined
      : {
          id: randomUUID(),
          roleKey: role.roleKey,
          cardVersion: role.cardVersion,
          startedAt: now,
          lastCallAt: undefined,
          contextTokens: 0,
          full: false,
        };
    const said: Message = { kind: "user", id: randomUUID(), threadId, text, at: now };
    const answering = await this.change(threadId, (latest) =>
      beginAnswer(latest, { said, personName: current.card.name, decision, newSession }),
    );
    void this.answer(answering, {
      said: { id: said.id, text },
      decision,
      role,
      replaced: newSession ? thread.session : undefined,
      briefText: brief.text,
    }).catch((error: unknown) => this.fail(threadId, error));
    return answering;
  }

  /** Ends every running session with the service. */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.live.keys()].map((threadId) => this.endLive(threadId)));
  }

  private async answer(
    thread: Thread,
    {
      said,
      decision,
      role,
      replaced,
      briefText,
    }: {
      /** The user's message, by the id its turn names it by. */
      readonly said: { readonly id: string; readonly text: string };
      readonly decision: ContextDecision;
      readonly role: SessionRole;
      /** The session the move replaces, which can't be resumed any more. */
      readonly replaced: ThreadSession | undefined;
      readonly briefText: string;
    },
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
    if (replaced) await this.sessionSkills.forget(replaced.id);
    const projects = await this.bases.refresh();
    this.logger.log(`Thread ${thread.id} reads ${projects.length} Projects' base branches.`);
    if (decision.move === "resume") {
      const skills = await this.sessionSkills.rebuild(session.id);
      const opened = await this.engine.resume(session.id, this.settingsOf(thread, role, skills));
      this.watch(thread.id, role.roleKey, opened);
      opened.send(said, "later");
      return;
    }
    const skills = await this.sessionSkills.prepare({
      sessionId: session.id,
      roleKey: role.roleKey,
      project: undefined,
    });
    const opened = await this.engine.start({
      id: session.id,
      settings: this.settingsOf(thread, role, skills),
      brief: { id: said.id, text: briefedMessage(briefText, said.text) },
    });
    this.watch(thread.id, role.roleKey, opened);
  }

  private settingsOf(
    thread: Thread,
    { roleKey, card }: SessionRole,
    skills: SessionSettings["skills"],
  ): SessionSettings {
    return {
      folder: this.bases.folder,
      // A chat runs no Project command, so it needs no Project's environment.
      environment: {},
      model: card.model,
      effort: card.effort,
      instructions: chatInstructions(card),
      skills: skills && {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      // A chat only reads (spec §6): the card's profile, narrowed.
      profile: { edit: false, run: { kind: "read-only-git" }, web: card.permissionProfile.web },
      officeTools: [],
      outputSchema: undefined,
      telemetry: {
        span: { "office.thread": thread.id, "office.role": roleKey },
        metric: { "office.conversation.home": thread.home.kind },
      },
    };
  }

  /** Reads the session's events into the log until it ends. */
  private watch(threadId: string, roleKey: string, session: EngineSession): void {
    const live: LiveSession = { session, roleKey, handingOver: false, idle: undefined };
    this.live.set(threadId, live);
    void this.read(threadId, live)
      .catch((error: unknown) => this.fail(threadId, error))
      .finally(() => {
        if (live.idle) clearTimeout(live.idle);
        if (this.live.get(threadId) === live) this.live.delete(threadId);
      });
  }

  private async read(threadId: string, live: LiveSession): Promise<void> {
    for await (const event of live.session.events) {
      switch (event.kind) {
        case "text":
          if (event.withinToolCall === undefined) {
            await this.log(threadId, [
              live.handingOver
                ? { kind: "handover-note", roleKey: live.roleKey, text: event.text }
                : { kind: "person", roleKey: live.roleKey, text: event.text },
            ]);
          }
          break;
        case "tool-call":
          if (event.withinToolCall === undefined) {
            await this.log(threadId, [
              {
                kind: "tool-activity",
                roleKey: live.roleKey,
                tool: event.tool,
                summary: toolActivitySummary(event.input),
              },
            ]);
          }
          break;
        case "tool-refused":
          await this.log(threadId, [
            {
              kind: "refusal",
              roleKey: live.roleKey,
              tool: event.tool,
              reason: event.reason,
            },
          ]);
          break;
        case "turn-ended":
          await this.turnEnded(threadId, live, event);
          break;
        default:
          break;
      }
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
    const handingOver = !wroteNote && usage.tokens >= usage.window * this.settings.handOverAtShare;
    await this.change(threadId, (thread) =>
      endTurn(thread, {
        usage: turn.usage,
        contextTokens: usage.tokens,
        handingOver,
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
    if (live.idle) clearTimeout(live.idle);
    await live.session.end().catch((error: unknown) => {
      this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
    });
  }

  /** The person couldn't answer: why goes into the log, and the Thread waits for the user. */
  private async fail(threadId: string, error: unknown): Promise<void> {
    this.logger.error(`Thread ${threadId} stopped answering: ${messageOf(error)}`);
    await this.endLive(threadId);
    await this.change(threadId, (thread) => failAnswer(thread, messageOf(error), new Date())).catch(
      (failure: unknown) => {
        this.logger.error(`Thread ${threadId}'s failure wasn't logged: ${messageOf(failure)}`);
      },
    );
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
