import type { ContextLimits } from "../domain/stage-context-limits.js";

/**
 * The Office defaults of an Agent Stage session's context limits, Settings › Office limits, which
 * Conversations keeps; the composition root binds it. A Stage without limits of its own runs under
 * them (spec §2.5).
 */
export abstract class StageContextLimitDefaults {
  /** The soft and hard limits as they are set now. */
  abstract stageContextLimits(): Promise<ContextLimits>;
}
