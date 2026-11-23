import { Injectable } from "@nestjs/common";
import type { EngineId } from "../domain/engines.js";
import type { NextWindowStart } from "../domain/window-starts.js";

/**
 * When each engine's next Window start fires (spec §5.4.6), as Settings › Engines shows it: the
 * scheduler (`WindowStarts`) keeps it here as it sets each wait, and the settings read it. Kept in
 * memory, worked out again at every boot.
 */
@Injectable()
export class NextWindowStarts {
  private readonly next = new Map<EngineId, NextWindowStart>();

  /** `engineId`'s next Window start; undefined when neither setting starts one or none is set. */
  of(engineId: EngineId): NextWindowStart | undefined {
    return this.next.get(engineId);
  }

  /** Keeps `next` as `engineId`'s next start, or none; whether it moved. */
  set(engineId: EngineId, next: NextWindowStart | undefined): boolean {
    const kept = this.next.get(engineId);
    if (kept?.at.getTime() === next?.at.getTime() && kept?.trigger === next?.trigger) return false;
    if (next === undefined) this.next.delete(engineId);
    else this.next.set(engineId, next);
    return true;
  }
}
