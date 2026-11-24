import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import { ProjectNotFound, ProjectRefused, TestTargets } from "../../projects/index.js";
import type { ProposedTestTargetsChange } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { UserRef } from "../domain/user.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of a Project's test targets (spec §2.12, "Writing test targets"), which Projects judges
 * and applies, refusing one whose targets changed since it was drafted, and marking each field it
 * changes as set by the Proposal and the Agent who drafted it. Conversations registers them, since
 * Conversations calls Projects.
 */
@Injectable()
export class TestTargetProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly testTargets: TestTargets,
    private readonly roleCards: RoleCards,
  ) {}

  onModuleInit(): void {
    this.appliers.register("test-targets", {
      problemsWith: ({ projectId, changes }) =>
        this.testTargets.proposedProblems(projectId, changes),
      apply: (change, proposedBy, appliedBy, proposalId) =>
        this.apply(change, proposedBy, appliedBy, proposalId),
    });
  }

  private async apply(
    change: ProposedTestTargetsChange,
    proposedBy: string,
    appliedBy: UserRef,
    proposalId: string | undefined,
  ): Promise<ProposedTestTargetsChange> {
    if (proposalId === undefined) {
      throw new Error("A Proposal of test targets is applied only as a stored Proposal.");
    }
    try {
      await this.testTargets.changeAsProposed(
        change.projectId,
        change.changes,
        {
          proposalId,
          agent: { roleKey: proposedBy, name: await this.nameOf(proposedBy) },
        },
        {
          kind: "proposal",
          proposalId,
          user: { userId: appliedBy.userId, name: appliedBy.name },
        },
      );
      return change;
    } catch (error) {
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
