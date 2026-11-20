import type { EngineId } from "../../engine/index.js";

/**
 * A Stage Thread's session couldn't go on on a Stand-in Engine (spec 5.4): it wasn't carried over,
 * or didn't resume there. The Thread stays on the engine `from`, where its session resumes later;
 * `cause` says why.
 */
export class SwitchFailed extends Error {
  constructor(
    readonly threadId: string,
    readonly from: EngineId,
    readonly to: EngineId,
    cause: unknown,
  ) {
    super(
      `Thread ${threadId}'s session couldn't go on on the engine ${to}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "SwitchFailed";
  }
}
