import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { EngineSessions } from "../../engine/index.js";
import { withMentionedRecords, type Mention } from "../domain/mention.js";
import { latestWriter, type MessageDelivery, type MessageImage } from "../domain/message.js";
import { withOpenPageRecord, type OpenPage } from "../domain/open-page.js";
import { messageFromUser } from "../domain/session-instructions.js";
import type { Thread } from "../domain/thread.js";
import {
  bargeIn,
  finishedFirst,
  markDelivery,
  type ThreadChange,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import type { UserRef } from "../domain/user.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { BargeIns } from "./barge-ins.js";
import { MentionedRecords } from "./mentioned-records.js";
import { ThreadImages } from "./thread-images.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;

/**
 * Where a Thread's session is in its life: being opened, in a turn, between turns, or being ended.
 */
export type SessionPhase = "opening" | "running" | "idle" | "ending";

/** Who runs the sessions of a Thread: `ThreadRunner` a chat's, a Task's or an Initiative's, `StageThreads` a Stage's. */
export type SessionOwner = "thread-runner" | "stage-threads";

/**
 * Out of an opening that `LiveSessions.end` stopped before its session ran: its message is why, which
 * the Thread's log says as the answer fails.
 */
export class OpeningStopped extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "OpeningStopped";
  }
}

/**
 * One opening of a Thread's session: from the moment an answer, or a Stage's work, begins until the
 * caller is done with it, the session running or not. `LiveSessions.end` stops it: the opening
 * checks after each step it awaits (`check`), and `LiveSessions.run` ends a session it got
 * meanwhile instead of running it, so a stopped opening never runs a turn.
 */
export class SessionOpening {
  private stoppedFor: string | undefined;
  private finish!: () => void;
  /** Settles once the caller is done with the opening (`LiveSessions.settle`). */
  readonly settled = new Promise<void>((resolve) => (this.finish = resolve));

  constructor(readonly threadId: string) {}

  get stopped(): boolean {
    return this.stoppedFor !== undefined;
  }

  /** Why it was stopped; undefined while it wasn't. */
  get stopReason(): string | undefined {
    return this.stoppedFor;
  }

  /** Throws `OpeningStopped` once the opening was stopped. */
  check(): void {
    if (this.stoppedFor !== undefined) throw new OpeningStopped(this.stoppedFor);
  }

  /** @internal `LiveSessions` stops it, once. */
  stop(reason: string): void {
    this.stoppedFor ??= reason;
  }

  /** @internal `LiveSessions` settles it. */
  done(): void {
    this.finish();
  }
}

/** One Thread's session through its life, as `LiveSessions` keeps it. */
interface SessionLife {
  readonly owner: SessionOwner;
  /** The opening under way, until its caller settles it. */
  opening: SessionOpening | undefined;
  /** The engine session running, in a turn or between turns. */
  session: EngineSession | undefined;
  turnRunning: boolean;
  /** The sessions being ended, which a session opened next waits for. */
  ending: Promise<void> | undefined;
}

/** What the user writes into a Thread whose person is answering, or whose Stage runs. */
export interface BargeInWritten {
  readonly text: string;
  readonly writtenBy: UserRef;
  readonly mentions: readonly Mention[];
  /** The page open beside the chat drawer as it was sent; a chat's only. */
  readonly openPage: OpenPage | undefined;
  readonly images: readonly MessageImage[];
}

/** Why a message written into a Stage Thread whose session is not at work is refused. */
const STAGE_ENDING = "The Stage is ending. Send your message once it has ended.";

/**
 * The one owner of the life of every Thread's session (spec §2.4, §2.5), chat Threads' and Stage
 * Threads' alike: an opening (`beginOpening`), which `end` can stop at any step; the session
 * running a turn or idle between turns (`run`, `turnBegan`, `turnEnded`); and its ending, which
 * the next opening waits for (`endSession`). Beside it, the user's messages into the answer or the
 * Stage's work under way (barge-in), held while the session opens and sent with priority `next`
 * once a turn runs.
 */
@Injectable()
export class LiveSessions {
  private readonly logger = new Logger(LiveSessions.name);
  private readonly lives = new Map<string, SessionLife>();
  /** The user's messages to the answer, or the Stage's work, under way, by Thread. */
  private readonly bargeIns = new Map<string, BargeIns>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly events: EventBus,
    private readonly mentionedRecords: MentionedRecords,
    private readonly threadImages: ThreadImages,
  ) {}

  /** Where the Thread's session is; undefined when it has none, nor one opening or ending. */
  phaseOf(threadId: string): SessionPhase | undefined {
    const life = this.lives.get(threadId);
    if (!life) return undefined;
    if (life.session && life.turnRunning) return "running";
    if (life.opening) return "opening";
    if (life.session) return "idle";
    return life.ending ? "ending" : undefined;
  }

  /** The engine session running behind the Thread, in a turn or between turns. */
  sessionOf(threadId: string): EngineSession | undefined {
    return this.lives.get(threadId)?.session;
  }

  /** Whether `session` is the one running behind the Thread: false once anything ended it. */
  holds(threadId: string, session: EngineSession): boolean {
    return this.sessionOf(threadId) === session;
  }

  /**
   * Begins opening the Thread's session, which runs once `run` takes the engine session it got;
   * the caller settles the opening once it is done with it (`settle`), the session running or not.
   */
  beginOpening(threadId: string, owner: SessionOwner): SessionOpening {
    const life = this.lifeOf(threadId, owner);
    life.opening?.stop("Another opening of the Thread's session took its place.");
    const opening = new SessionOpening(threadId);
    life.opening = opening;
    return opening;
  }

  /**
   * The opening's session runs, in its first turn. Stopped meanwhile, the session is ended instead
   * and `OpeningStopped` thrown, so the caller cleans up what it prepared.
   */
  async run(opening: SessionOpening, session: EngineSession): Promise<void> {
    const life = this.lives.get(opening.threadId);
    if (life?.opening !== opening) opening.stop("Another opening took its place.");
    if (!life || opening.stopped) {
      await this.endEngineSession(opening.threadId, session);
      throw new OpeningStopped(opening.stopReason ?? "The session stopped opening.");
    }
    life.session = session;
    life.turnRunning = true;
  }

  /**
   * The opening goes on in the session running behind the Thread, `session`, in a new turn; false
   * when that session ended meanwhile, for the opening to open one. Throws `OpeningStopped` once
   * stopped.
   */
  goOn(opening: SessionOpening, session: EngineSession): boolean {
    opening.check();
    const life = this.lives.get(opening.threadId);
    if (!life || life.session !== session) return false;
    life.turnRunning = true;
    return true;
  }

  /** The caller is done with the opening: `end` stops waiting for it. */
  settle(opening: SessionOpening): void {
    const life = this.lives.get(opening.threadId);
    if (life?.opening === opening) life.opening = undefined;
    opening.done();
    this.dropIfOver(opening.threadId);
  }

  /** `session` is in a turn again, as the engine began one or a message started one. */
  turnBegan(threadId: string, session: EngineSession): void {
    const life = this.lives.get(threadId);
    if (life?.session === session) life.turnRunning = true;
  }

  /** `session`'s turn ended with nothing to follow it: idle until the next. */
  turnEnded(threadId: string, session: EngineSession): void {
    const life = this.lives.get(threadId);
    if (life?.session === session) life.turnRunning = false;
  }

  /** `session`'s events ended of its own accord, as when its process exited. */
  sessionEnded(threadId: string, session: EngineSession): void {
    const life = this.lives.get(threadId);
    if (life?.session !== session) return;
    life.session = undefined;
    life.turnRunning = false;
    this.dropIfOver(threadId);
  }

  /**
   * Ends the session running behind the Thread, `session` only when given, never stopping an
   * opening; resolves once every session ending there has ended.
   */
  async endSession(threadId: string, session?: EngineSession): Promise<void> {
    const life = this.lives.get(threadId);
    if (!life) return;
    const running = life.session;
    if (running && (session === undefined || session === running)) {
      life.session = undefined;
      life.turnRunning = false;
      const ended = this.endEngineSession(threadId, running);
      life.ending = life.ending ? Promise.all([life.ending, ended]).then(() => undefined) : ended;
    }
    const ending = life.ending;
    await ending;
    if (life.ending === ending) life.ending = undefined;
    this.dropIfOver(threadId);
  }

  /** Resolves once the sessions ending behind the Thread have ended. */
  async ended(threadId: string): Promise<void> {
    await this.lives.get(threadId)?.ending;
  }

  /**
   * Ends whatever the Thread's session is doing: an opening under way is stopped for `reason`,
   * which its caller logs as the answer fails, and waited for; a running session is ended. Never
   * called from within the opening it would wait for.
   */
  async end(threadId: string, reason: string): Promise<void> {
    const opening = this.lives.get(threadId)?.opening;
    opening?.stop(reason);
    await this.endSession(threadId);
    await opening?.settled;
  }

  /**
   * Ends the sessions of every Thread `owner` runs, as the service stops: openings are stopped
   * for `reason` without waiting for them.
   */
  async endEvery(owner: SessionOwner, reason: string): Promise<void> {
    const owned = [...this.lives].filter(([, life]) => life.owner === owner);
    for (const [, life] of owned) life.opening?.stop(reason);
    await Promise.all(owned.map(([threadId]) => this.endSession(threadId)));
  }

  /**
   * The answer, or the Stage's work, under way in the Thread takes the user's messages from now
   * on (barge-in), each sent to its running session with priority `next`; `turnRunning` false holds
   * them until its turn starts.
   */
  answerBegins(threadId: string, turnRunning: boolean): BargeIns {
    const bargeIns = new BargeIns(
      (message) => this.sessionOf(threadId)?.send(message, "next"),
      turnRunning,
    );
    this.bargeIns.set(threadId, bargeIns);
    return bargeIns;
  }

  /** The user's messages to the answer, or the Stage's work, under way in the Thread. */
  bargeInsOf(threadId: string): BargeIns | undefined {
    return this.bargeIns.get(threadId);
  }

  /** The answer, or the Stage's work, ended: its messages that never landed, which won't any more. */
  closeBargeIns(threadId: string): readonly string[] {
    const bargeIns = this.bargeIns.get(threadId);
    this.bargeIns.delete(threadId);
    return bargeIns?.end() ?? [];
  }

  /** As `closeBargeIns`, marking the messages that never landed not delivered. */
  async endBargeIns(threadId: string): Promise<void> {
    await this.mark(threadId, this.closeBargeIns(threadId), "not-delivered");
  }

  /**
   * The user writes while the person answers, or a Stage runs (barge-in, spec §2.4): the message is
   * logged waiting, with the user who wrote it and its Open page, and goes to the turn running, or
   * to the one about to start, with the record of each Task, Idea or Decision it mentions and the
   * Open page's record as any message to a running session; the person reads who wrote it unless
   * the same user wrote the one before. Marked delivered once a turn has taken it. Refused once the
   * answer, or the Stage's work, has ended; `personName` names who answers in a chat's refusal.
   */
  async bargeIn(
    thread: Thread,
    personName: string | undefined,
    { text, writtenBy, mentions, openPage, images }: BargeInWritten,
  ): Promise<Thread> {
    const bargeIns = this.bargeIns.get(thread.id);
    if (!bargeIns) {
      throw new ThreadRefused([
        thread.stageThread ? STAGE_ENDING : finishedFirst(thread, personName),
      ]);
    }
    const mentioned = await this.mentionedRecords.read(mentions);
    // Read before the message is logged, so the log holds only the messages before it.
    const page = await this.mentionedRecords.openPageOfRunningSession(
      thread.id,
      openPage,
      mentions,
    );
    const previous = latestWriter(await this.repository.messages(thread.id));
    const fromUser = messageFromUser(text, writtenBy, previous);
    const contents = await this.threadImages.contents(images);
    const id = randomUUID();
    const logged = await this.change(thread.id, (latest) =>
      bargeIn(latest, { id, text, writtenBy, openPage, personName, at: new Date(), images }),
    );
    const said = {
      id,
      text: withOpenPageRecord(withMentionedRecords(fromUser, mentioned), page),
      ...(contents.length > 0 && { images: contents }),
    };
    if (!bargeIns.take(said)) await this.mark(thread.id, [id], "not-delivered");
    return logged;
  }

  private lifeOf(threadId: string, owner: SessionOwner): SessionLife {
    const life = this.lives.get(threadId);
    if (life) return life;
    const begun: SessionLife = {
      owner,
      opening: undefined,
      session: undefined,
      turnRunning: false,
      ending: undefined,
    };
    this.lives.set(threadId, begun);
    return begun;
  }

  /** A life with nothing opening, running or ending is over. */
  private dropIfOver(threadId: string): void {
    const life = this.lives.get(threadId);
    if (life && !life.opening && !life.session && !life.ending) this.lives.delete(threadId);
  }

  private async endEngineSession(threadId: string, session: EngineSession): Promise<void> {
    await session.end().catch((error: unknown) => {
      this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
    });
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

  private async change<Event extends DomainEvent>(
    threadId: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<Thread> {
    const { thread, event } = await this.repository.update(threadId, change);
    if (event) await this.events.publish(event);
    return thread;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
