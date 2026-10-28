import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PROPOSE_PROJECT_COMMANDS_TOOL, projectCommandFieldsSchema } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { ProjectService, proposedCommandFields } from "../../../projects/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with the Project's values now and as proposed; nothing changes until the user applies it, and it is refused if those values change first. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tool Devops drafts a change to a Project's commands and install inputs with (spec
 * §2.3), a Proposal the user applies with a click. Like every Proposal tool it changes nothing
 * itself, so it sits behind no Hard switch, and returns at once.
 */
@Injectable()
export class ProjectCommandOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly projects: ProjectService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_PROJECT_COMMANDS_TOOL,
      description:
        "Drafts a change to a Project's commands and install inputs as a Proposal the user applies with a click. It shows in this Thread as a card, with the values now and the ones proposed, and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        project: z.string().describe("The Project's id, as list_projects gives it."),
        change: projectCommandFieldsSchema.describe(
          "Only what changes, each one whole: a command (install, build, lint, test) as one command line for the platform's shell, and installInputs as the whole list of paths inside the repository whose change makes a worktree install again.",
        ),
      }),
      run: async ({ project: projectId, change }, { sessionId }) => {
        const project = await this.projects.find(projectId.trim());
        if (!project) return { text: `The Office has no Project "${projectId}".`, isError: true };
        return refusedToTheAgent(async () => {
          await this.proposals.draft(sessionId, {
            kind: "project-commands",
            projectId: project.id,
            ...proposedCommandFields(project, change),
          });
          return DRAFTED;
        });
      },
    });
  }
}
