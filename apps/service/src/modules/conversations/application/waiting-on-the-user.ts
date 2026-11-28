import { Injectable } from "@nestjs/common";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService, type DecisionWaitingOnTheUser } from "./decision-service.js";
import { ProposalService, type ProposalWaitingOnTheUser } from "./proposal-service.js";

/** An Initiative whose person answered in its newest Thread and waits on the user's reply. */
export interface InitiativeReply {
  readonly initiativeId: string;
  readonly threadId: string;
  /** The person who answered, by the key of their Role. */
  readonly roleKey: string;
  /** When their last message was logged. */
  readonly answeredAt: Date;
}

/**
 * What waits on the user in Conversations, as Now reads it: the open Decisions, the Proposals no
 * user has applied or declined, and the Initiatives whose person answered and waits on a reply.
 */
@Injectable()
export class WaitingOnTheUser {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly decisions: DecisionService,
    private readonly proposals: ProposalService,
  ) {}

  /** The open Decisions, as `DecisionService.listOpen` lists them. */
  openDecisions(): Promise<readonly DecisionWaitingOnTheUser[]> {
    return this.decisions.listOpen();
  }

  /** The Proposals waiting on the user, as `ProposalService.waitingOnTheUser` lists them. */
  openProposals(): Promise<readonly ProposalWaitingOnTheUser[]> {
    return this.proposals.waitingOnTheUser();
  }

  /**
   * Of the Initiatives `initiativeIds`, those whose person has answered in their newest Thread that
   * isn't a Consultation and waits on the user's reply: the Thread waits with a session and no open
   * Decision, and the person's last message came after the user's last, or the user wrote none.
   */
  async initiativeReplies(initiativeIds: readonly string[]): Promise<readonly InitiativeReply[]> {
    const newest = await this.repository.newestInitiativeThreads(initiativeIds);
    return newest.flatMap((thread) => {
      const answeredAt = thread.lastPersonMessageAt;
      const waits =
        thread.state === "waiting" &&
        thread.hasSession &&
        !thread.holdsOpenDecision &&
        thread.personSpokeLast;
      if (!waits || !answeredAt) return [];
      const { initiativeId, threadId, roleKey } = thread;
      return [{ initiativeId, threadId, roleKey, answeredAt }];
    });
  }
}
