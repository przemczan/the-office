import type { OpenDecision, OpenProposal, ShapingReply } from "../domain/now.js";

/**
 * What waits on the user in the Threads Conversations keeps, as Now reads it; the composition root
 * binds it.
 */
export abstract class WaitingInConversations {
  /** The Decisions waiting on the user. */
  abstract openDecisions(): Promise<readonly OpenDecision[]>;

  /** The Proposals no user has applied or declined yet, in any Thread. */
  abstract openProposals(): Promise<readonly OpenProposal[]>;

  /**
   * Of the Initiatives `initiativeIds` alone, those whose person has answered in their newest
   * Thread and waits on the user's reply, such as a shaper in a shaping Thread.
   */
  abstract initiativeReplies(initiativeIds: readonly string[]): Promise<readonly ShapingReply[]>;
}
