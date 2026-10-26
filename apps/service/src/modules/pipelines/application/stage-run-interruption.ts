import { actsNow, outranks, stopsCommands } from "../domain/stage-interruption.js";
import type { StageInterruption } from "../domain/stage-run.js";

/**
 * What was asked of a Stage run going on (spec §2.4): Pause holds it once the Agent's current turn
 * ends, Stop interrupts it now, and The Office shutting down interrupts it now with its Project
 * commands. Each escalates what was asked before it; nothing undoes one.
 */
export class StageRunInterruption {
  private asked: StageInterruption | undefined;
  private readonly nowListeners = new Set<() => void>();
  private readonly commandsStop = new AbortController();

  /** Undefined while nobody has asked. */
  get requested(): StageInterruption | undefined {
    return this.asked;
  }

  /** Whether the run is to stop what runs now, not wait for the turn to end. */
  get now(): boolean {
    return this.asked !== undefined && actsNow(this.asked);
  }

  /** Aborted once the run's Project commands are to stop too. */
  get commandsSignal(): AbortSignal {
    return this.commandsStop.signal;
  }

  request(interruption: StageInterruption): void {
    if (!outranks(interruption, this.asked)) return;
    const wasNow = this.now;
    this.asked = interruption;
    if (stopsCommands(interruption)) this.commandsStop.abort();
    if (!wasNow && this.now) for (const listener of this.nowListeners) listener();
  }

  /** Calls `listener` once the run is to stop now; returns what removes it. */
  onNow(listener: () => void): () => void {
    this.nowListeners.add(listener);
    return () => this.nowListeners.delete(listener);
  }
}
