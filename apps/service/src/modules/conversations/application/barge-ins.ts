import type { UserRef } from "../domain/user.js";

/** A message to the person, by the id the turn that takes it names it by. */
export interface BargeInMessage {
  readonly id: string;
  readonly text: string;
}

/** What a turn's end meant for the user's messages. */
export interface BargeInsAfterTurn {
  /** The messages the turn took. */
  readonly delivered: readonly string[];
  /** Messages sent are still to land: the engine starts a turn with them, which is read in turn. */
  readonly stillToLand: boolean;
}

/**
 * The messages the user writes into a Thread while the person answers there, or a Stage runs
 * (barge-in, spec §2.4), each sent with priority `next` so it lands at the next safe point, between
 * tool calls, of the turn running. While no turn runs, as between a Stage's turns while The Office
 * reads the last one, or while the session opens, a message is held and goes once the next turn
 * starts: sent then, it would start a turn of its own, read as the answer to something else.
 */
export class BargeIns {
  private ended = false;
  private readonly held: BargeInMessage[] = [];
  private readonly sent = new Set<string>();
  private latestWriter: UserRef | undefined;

  /** `turnRunning` is false when the session that takes the messages hasn't started its turn yet. */
  constructor(
    private readonly sendNext: (message: BargeInMessage) => void,
    private turnRunning = true,
  ) {}

  /**
   * Who wrote the message before `writer`'s in this session, undefined for its first, so a session
   * that started on a Brief, not on a user's message, learns who writes; `writer` is kept as the
   * latest.
   */
  writerBefore(writer: UserRef): UserRef | undefined {
    const before = this.latestWriter;
    this.latestWriter = writer;
    return before;
  }

  /** False once the session has ended: the message can't reach the person. */
  take(message: BargeInMessage): boolean {
    if (this.ended) return false;
    if (this.turnRunning) this.send(message);
    else this.held.push(message);
    return true;
  }

  /** The message that starts a turn has been sent: the held messages follow it. */
  turnStarted(): void {
    this.turnRunning = true;
    for (const message of this.held.splice(0)) this.send(message);
  }

  /**
   * A turn ended having taken `consumedMessageIds`. A turn that ended without failing before a
   * message sent landed is followed by one the engine starts with it.
   */
  turnEnded(consumedMessageIds: readonly string[], completed: boolean): BargeInsAfterTurn {
    const delivered = consumedMessageIds.filter((id) => this.sent.delete(id));
    const stillToLand = completed && this.sent.size > 0;
    if (!stillToLand) this.turnRunning = false;
    return { delivered, stillToLand };
  }

  /** The session ends: the messages that never landed, which won't any more. */
  end(): readonly string[] {
    this.ended = true;
    const undelivered = [...this.sent, ...this.held.map((message) => message.id)];
    this.sent.clear();
    this.held.length = 0;
    return undelivered;
  }

  private send(message: BargeInMessage): void {
    this.sent.add(message.id);
    this.sendNext(message);
  }
}
