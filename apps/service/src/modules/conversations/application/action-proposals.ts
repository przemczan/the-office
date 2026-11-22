import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import { ProjectActions, ProjectNotFound, ProjectRefused } from "../../projects/index.js";
import type { ProposedActionsChange } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of a Project's Actions (spec §2.15, "Defining Actions"), which Projects judges and
 * applies all or nothing, refusing one whose Actions changed since it was drafted, one that clears
 * Leaves the workstation, and any while the Project has Actions switched off, and marking each
 * value it changes as set by the Proposal and the Agent who drafted it. Conversations registers
 * them, since Conversations calls Projects.
 */
@Injectable()
export class ActionProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly actions: ProjectActions,
    private readonly roleCards: RoleCards,
  ) {}

  onModuleInit(): void {
    this.appliers.register("actions", {
      problemsWith: ({ projectId, changes }) => this.actions.proposedProblems(projectId, changes),
      apply: (change, proposedBy, _appliedBy, proposalId) =>
        this.apply(change, proposedBy, proposalId),
    });
  }

  private async apply(
    change: ProposedActionsChange,
    proposedBy: string,
    proposalId: string | undefined,
  ): Promise<ProposedActionsChange> {
    if (proposalId === undefined) {
      throw new Error("A Proposal of Actions is applied only as a stored Proposal.");
    }
    try {
      await this.actions.changeAsProposed(change.projectId, change.changes, {
        proposalId,
        agent: { roleKey: proposedBy, name: await this.nameOf(proposedBy) },
      });
      return change;
    } catch (error) {
      // FeatureSwitchedOff is a ProjectRefused, so a switched-off Project is refused in its words.
      if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof ProjectNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }

  /** The name of the person who fills the Role; its key when nobody does now. */
  private async nameOf(roleKey: string): Promise<string> {
    return (await this.roleCards.find(roleKey))?.card.name ?? roleKey;
  }
}
