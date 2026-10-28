import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ProjectNotFound, ProjectRefused, ProjectService } from "../../projects/index.js";
import type { ProposedProjectCommands } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of a Project's commands and install inputs (spec §2.3), which Projects judges and
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
      problemsWith: ({ projectId, from, to }) =>
        this.projects.proposedCommandsProblems(projectId, from, to),
      apply: (change) => this.apply(change),
    });
  }

  private async apply(change: ProposedProjectCommands): Promise<ProposedProjectCommands> {
    try {
      await this.projects.changeCommandsAsProposed(change.projectId, change.from, change.to);
      return change;
    } catch (error) {
      if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof ProjectNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}
