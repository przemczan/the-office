import { actsNow } from "../domain/stage-interruption.js";
import type { StageInterruption } from "../domain/stage-run.js";

/**
 * What the user asked of a Stage run going on (spec §2.4): Pause holds it once the Agent's current
 * turn ends, Stop interrupts it now. A Stop after a Pause escalates it; nothing undoes a Stop.
 */
export class StageRunInterruption {
  private asked: StageInterruption | undefined;
  private readonly nowListeners = new Set<() => void>();

  /** Undefined while nobody has asked. */
  get requested(): StageInterruption | undefined {
    return this.asked;
  }

  /** Whether the run is to stop what runs now, not wait for the turn to end. */
  get now(): boolean {
    return this.asked !== undefined && actsNow(this.asked);
  }

  request(interruption: StageInterruption): void {
    if (this.now) return;
    this.asked = interruption;
    if (this.now) for (const listener of this.nowListeners) listener();
  }

  /** Calls `listener` once the run is to stop now; returns what removes it. */
  onNow(listener: () => void): () => void {
    this.nowListeners.add(listener);
    return () => this.nowListeners.delete(listener);
  }
}
