import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  commandEditsOfProposed,
} from "../../projects/index.js";
import type { ProposedProjectCommands } from "../domain/proposal.js";
import type { UserRef } from "../domain/user.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of a Project's install command, install inputs and commands (spec §2.3), which Projects judges and
 * applies, refusing one whose fields changed since it was drafted. Conversations registers them,
 * since Conversations calls Projects.
 */
@Injectable()
export class ProjectCommandProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly projects: ProjectService,
  ) {}

  onModuleInit(): void {
    this.appliers.register("project-commands", {
      problemsWith: ({ projectId, changes }) =>
        this.projects.proposedCommandsProblems(projectId, changes),
      apply: (change, _proposedBy, appliedBy, proposalId) =>
        this.apply(change, appliedBy, proposalId),
    });
  }

  /** Recorded as the Proposal's, or as the user's own change when applied apart from one. */
  private async apply(
    change: ProposedProjectCommands,
    appliedBy: UserRef,
    proposalId: string | undefined,
  ): Promise<ProposedProjectCommands> {
    const user = { userId: appliedBy.userId, name: appliedBy.name };
    try {
      // The drift check first (a field changed since it was drafted), then the one shared handler.
      const problems = await this.projects.proposedCommandsProblems(
        change.projectId,
        change.changes,
      );
      if (problems.length > 0) throw new ProposalRefused(problems);
      await this.projects.changeCommands(
        change.projectId,
        commandEditsOfProposed(change.changes),
        proposalId === undefined ? { kind: "user", user } : { kind: "proposal", proposalId, user },
      );
      return change;
    } catch (error) {
      if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof ProjectNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}
