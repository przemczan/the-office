import type { ShapingReply } from "../domain/now.js";

/**
 * The Initiatives whose shaper has answered in their shaping Thread and waits on the user's reply;
 * the composition root binds it.
 */
export abstract class ShapingReplies {
  /** Of the Initiatives `initiativeIds` alone. */
  abstract waitingForReply(initiativeIds: readonly string[]): Promise<readonly ShapingReply[]>;
}
