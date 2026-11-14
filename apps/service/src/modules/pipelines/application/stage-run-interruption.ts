import {
  actsNow,
  outranks,
  stopsCommands,
  waitsForTheTurn,
  type CutShortBy,
} from "../domain/stage-interruption.js";
import type { HoldingUser, StageInterruption } from "../domain/stage-run.js";

/**
 * What was asked of a Stage run going on (spec §2.4, §2.8): Pause holds it once the Agent's current
 * turn ends, the fire alarm too but stops its Project commands now, Stop interrupts it now, and The
 * Office shutting down interrupts it now with its Project commands. Each escalates what was asked
 * before it; nothing undoes one. A shutdown, or the alarm's hard stop, after a Pause or the alarm
 * cuts the turn short but leaves the run held, its edits kept (the user's answer of 2026-10-26).
 */
export class StageRunInterruption {
  private asked: StageInterruption | undefined;
  private askedBy: HoldingUser | undefined;
  private cutBy: CutShortBy | undefined;
  private readonly nowListeners = new Set<() => void>();
  private readonly commandsStop = new AbortController();

  /** Undefined while nobody has asked. */
  get requested(): StageInterruption | undefined {
    return this.asked;
  }

  /** The user whose Pause or Stop is `requested`; undefined for any other, or none named. */
  get heldByUser(): HoldingUser | undefined {
    return this.askedBy;
  }

  /** Whether the run is to stop what runs now, not wait for the turn to end. */
  get now(): boolean {
    return this.cutBy !== undefined || (this.asked !== undefined && actsNow(this.asked));
  }

  /** What cut the Agent's turn of a held run short; undefined while nothing did. */
  get cutShortBy(): CutShortBy | undefined {
    return this.cutBy;
  }

  /** Aborted once the run's Project commands are to stop too. */
  get commandsSignal(): AbortSignal {
    return this.commandsStop.signal;
  }

  /** `user` asked for it, for the user's Pause or Stop. */
  request(interruption: StageInterruption, user?: HoldingUser): void {
    if (!outranks(interruption, this.asked)) return;
    const wasNow = this.now;
    if (interruption === "restart" && waitsForTheTurn(this.asked)) this.cutBy = "restart";
    else {
      this.asked = interruption;
      this.askedBy = user;
    }
    if (stopsCommands(interruption)) this.commandsStop.abort();
    if (!wasNow && this.now) this.tellNow();
  }

  /**
   * The fire alarm's hard stop (spec §2.8): a run held until its Agent's turn ends has that turn
   * cut short now, its edits kept. Nothing to a run that nobody held, or that stops now already.
   */
  hardStop(): void {
    if (!waitsForTheTurn(this.asked) || this.now) return;
    this.cutBy = "alarm";
    this.tellNow();
  }

  /** Calls `listener` once the run is to stop now; returns what removes it. */
  onNow(listener: () => void): () => void {
    this.nowListeners.add(listener);
    return () => this.nowListeners.delete(listener);
  }

  private tellNow(): void {
    for (const listener of this.nowListeners) listener();
  }
}
