/** A message to the person, by the id the turn that takes it names it by. */
export interface BargeInMessage {
  readonly id: string;
  readonly text: string;
}

/** What a turn's end meant for the user's messages. */
export interface BargeInsAfterTurn {
  /** The messages the turn took. */
  readonly delivered: readonly string[];
  /** Messages sent are still to land: the engine starts a turn with them, which the Stage reads. */
  readonly stillToLand: boolean;
}

/**
 * The messages the user writes into a running Stage Thread (barge-in, spec §2.4), each sent with
 * priority `next` so it lands at the next safe point, between tool calls, of the turn running.
 * Between the Stage's turns, while The Office reads the last one, a message is held and goes with
 * The Office's next message: sent then, it would start a turn of its own that The Office would
 * read as the answer to something else.
 */
export class BargeIns {
  private turnRunning = true;
  private ended = false;
  private readonly held: BargeInMessage[] = [];
  private readonly sent = new Set<string>();

  constructor(private readonly sendNext: (message: BargeInMessage) => void) {}

  /** False once the Stage's session has ended: the message can't reach the person. */
  take(message: BargeInMessage): boolean {
    if (this.ended) return false;
    if (this.turnRunning) this.send(message);
    else this.held.push(message);
    return true;
  }

  /** The Office has sent its next message, which starts a turn: the held messages follow it. */
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
