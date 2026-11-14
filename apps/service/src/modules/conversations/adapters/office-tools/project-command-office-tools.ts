import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PROPOSE_PROJECT_COMMANDS_TOOL, projectCommandSchema } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { ProjectService, proposedCommands } from "../../../projects/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with the Project's values now and as proposed; nothing changes until the user applies it, and it is refused if those values change first. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tool whoever onboards Projects drafts a change to a Project's install command, install inputs and
 * commands with (spec §2.3), a Proposal the user applies with a click. Like every Proposal tool it changes nothing
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
        "Drafts a change to a Project's install command, install inputs, before and after publishing lines and commands as a Proposal the user applies with a click, all or nothing. It shows in this Thread as a card, with the values now and the ones proposed, and changes nothing until the user applies it. It returns at once.",
      input: z.object({
        project: z.string().describe("The Project's id, as list_projects gives it."),
        change: z
          .object({
            installCommand: z
              .string()
              .optional()
              .describe("The install command, as one command line for the platform's shell."),
            installInputs: z
              .array(z.string())
              .optional()
              .describe(
                "The whole list of paths inside the repository whose change makes a worktree install again.",
              ),
            beforePublishingCommand: z
              .string()
              .optional()
              .describe(
                "Before publishing: one command line run in the Task's worktree before Publish ships anything, with the Project's own variables and never The Office's credentials; what it changes is committed and shipped. It runs again each time Publish runs, so it must be safe to run twice. Blank clears it.",
              ),
            afterPublishingCommand: z
              .string()
              .optional()
              .describe(
                "After publishing: one command line run in the Task's worktree once Publish opened the pull request or merged, with OFFICE_PUBLISHED_BRANCH, OFFICE_PUBLISHED_COMMIT, OFFICE_PULL_REQUEST_URL and OFFICE_PUBLISHING_MODE besides the Project's own variables, never The Office's credentials. Safe to run twice; the Script Stage time limit applies. Blank clears it.",
              ),
            commands: z
              .array(projectCommandSchema)
              .optional()
              .describe(
                'Commands to add, or to change by their key, each whole: a key (lower-case letters, digits and "-", starting with a letter; not install or publish), a name, a kind (build, lint or test; a test command\'s runs never reach the work) and one command line.',
              ),
            removeCommands: z
              .array(z.string())
              .optional()
              .describe("The keys of the commands to remove."),
          })
          .describe("Only what changes."),
      }),
      run: async ({ project: projectId, change }, { sessionId }) => {
        const project = await this.projects.find(projectId.trim());
        if (!project) return { text: `The Office has no Project "${projectId}".`, isError: true };
        return refusedToTheAgent(async () => {
          await this.proposals.draft(sessionId, {
            kind: "project-commands",
            projectId: project.id,
            changes: proposedCommands(project, change),
          });
          return DRAFTED;
        });
      },
    });
  }
}
