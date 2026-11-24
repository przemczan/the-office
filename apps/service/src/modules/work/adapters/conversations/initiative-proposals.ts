import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProposedInitiativeChange,
} from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { byTheUser, type UserRef } from "../../domain/author.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { InitiativeRefused } from "../../domain/initiative-refused.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";

/**
 * Proposals of the shaper's changes to an active Initiative (spec §2.1 Defaults), the shaper being
 * whoever holds Shapes Initiatives, which Work judges and applies under the Initiative's hold. Work
 * fills Conversations' registry itself, since Work calls Conversations.
 */
@Injectable()
export class InitiativeProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly initiatives: InitiativeService,
  ) {}

  onModuleInit(): void {
    this.appliers.register("initiative", {
      problemsWith: ({ initiativeId, edit }) =>
        this.initiatives.problemsWithProposal(initiativeId, edit),
      apply: (change, proposedBy, appliedBy) => this.apply(change, proposedBy, appliedBy),
    });
  }

  /**
   * A refusal leaves the Proposal open, in the words Work refuses the change with. What it adds is
   * the proposer's; the edits it makes are kept as the user's who applied it.
   */
  private async apply(
    change: ProposedInitiativeChange,
    proposedBy: string,
    appliedBy: UserRef,
  ): Promise<ProposedInitiativeChange> {
    try {
      const edit = await this.initiatives.applyProposal(
        change.initiativeId,
        change.edit,
        { kind: "person", roleKey: proposedBy },
        byTheUser(appliedBy),
      );
      return { ...change, edit };
    } catch (error) {
      if (error instanceof InitiativeRefused || error instanceof TaskRefused) {
        throw new ProposalRefused(error.reasons);
      }
      if (error instanceof InitiativeNotFound || error instanceof TaskNotFound) {
        throw new ProposalRefused([error.message]);
      }
      throw error;
    }
  }
}
