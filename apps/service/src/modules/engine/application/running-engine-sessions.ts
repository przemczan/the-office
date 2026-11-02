import { Injectable } from "@nestjs/common";
import type { EngineId } from "../domain/engines.js";

/**
 * The sessions running on each engine, so a removed engine's folder goes only once they have
 * ended (spec §5.4: a running session finishes on the old engine). A session counts from the moment
 * it is asked for, before its engine is looked up, so one that found the engine listed just before
 * its removal is waited for too.
 */
@Injectable()
export class RunningEngineSessions {
  private readonly running = new Map<EngineId, number>();
  private readonly waiting = new Map<EngineId, (() => void)[]>();

  /** Counts a session on `engineId` until the returned `ended` is called; calling it again does nothing. */
  started(engineId: EngineId): () => void {
    this.running.set(engineId, (this.running.get(engineId) ?? 0) + 1);
    let counted = true;
    return () => {
      if (!counted) return;
      counted = false;
      this.end(engineId);
    };
  }

  /** Resolves once no session runs on `engineId`, at once when none does. */
  allEnded(engineId: EngineId): Promise<void> {
    if (!this.running.has(engineId)) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiting.set(engineId, [...(this.waiting.get(engineId) ?? []), resolve]);
    });
  }

  private end(engineId: EngineId): void {
    const left = (this.running.get(engineId) ?? 1) - 1;
    if (left > 0) {
      this.running.set(engineId, left);
      return;
    }
    this.running.delete(engineId);
    const waiting = this.waiting.get(engineId) ?? [];
    this.waiting.delete(engineId);
    for (const resolve of waiting) resolve();
  }
}
