import { Injectable } from "@nestjs/common";
import type { StageKind } from "../domain/stage.js";

/** The kinds of Stage whose runs count as running for System health's Load now (spec 2.11). */
const COUNTED: ReadonlySet<StageKind> = new Set<StageKind>(["agent", "script"]);

/**
 * The Agent and Script Stage runs running now, on any Task, kept in memory as the interpreter runs
 * them: a restart ends all of them. Stats reads it for System health's Load now.
 */
@Injectable()
export class StageRunsRunningNow {
  private running = 0;

  /** Counts a run of `kind` until the returned function is called; calling it again does nothing. */
  began(kind: StageKind): () => void {
    if (!COUNTED.has(kind)) return () => undefined;
    this.running += 1;
    let counted = true;
    return () => {
      if (!counted) return;
      counted = false;
      this.running -= 1;
    };
  }

  /** How many Agent and Script Stage runs are running now. */
  count(): number {
    return this.running;
  }
}
