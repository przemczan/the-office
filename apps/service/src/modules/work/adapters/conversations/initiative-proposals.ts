import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProposedInitiativeChange,
} from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { InitiativeRefused } from "../../domain/initiative-refused.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";

/**
 * Proposals of the CTO's changes to an active Initiative (spec §2.1 Defaults), which Work judges
 * and applies under the Initiative's hold. Work fills Conversations' registry itself, since Work
 * calls Conversations.
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
      apply: (change, proposedBy) => this.apply(change, proposedBy),
    });
  }

  /** A refusal leaves the Proposal open, in the words Work refuses the change with. */
  private async apply(
    change: ProposedInitiativeChange,
    proposedBy: string,
  ): Promise<ProposedInitiativeChange> {
    try {
      const edit = await this.initiatives.applyProposal(change.initiativeId, change.edit, {
        kind: "person",
        roleKey: proposedBy,
      });
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
