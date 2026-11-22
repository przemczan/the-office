import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ACTION_NAME_MAX_LENGTH,
  ACTION_TIME_LIMIT_MINUTES,
  PROPOSE_ACTIONS_TOOL,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import {
  ProjectActions,
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  type ActionFields,
} from "../../../projects/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with each Action's values now and as proposed; nothing changes until the user applies it, all or nothing, and it is refused if those values change first. Don't wait for it: tell the user what you propose and why, in a line or two, and name any Secret variable an Action needs that the Project doesn't have yet.";

const head = {
  key: z
    .string()
    .describe(
      "The Action's key: lower-case letters, digits and \"-\", starting with a letter, as a Project command's; a new key adds an Action, an existing one changes it. Fixed once added.",
    ),
  name: z
    .string()
    .describe(
      `The Action's name, as the user reads it on the Project page, at most ${ACTION_NAME_MAX_LENGTH} characters, such as "Install on my phone" or "Release".`,
    ),
  leavesTheWorkstation: z
    .boolean()
    .describe(
      "Whether what it runs pushes, publishes, deploys or releases: anything that reaches people or systems outside this Office. A Proposal may set it true, never clear it: give true for an Action marked now. A Workflow is always marked as it is added or changed to one.",
    ),
};

const actionInput = z.discriminatedUnion("kind", [
  z.object({
    ...head,
    kind: z
      .literal("project-command")
      .describe("Runs one of the Project's commands, in a checkout of its own."),
    settings: z.object({
      commandKey: z
        .string()
        .describe(
          "The key of the Project's command it runs, as list_projects lists it; never a command line.",
        ),
      commandsBefore: z
        .array(z.string())
        .default([])
        .describe(
          "The keys of the Project's commands (or install for its install command) run before it, in this order, since the checkout has nothing installed; none when left out.",
        ),
      timeLimitMinutes: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe(
          `Its own time limit in minutes, ${ACTION_TIME_LIMIT_MINUTES.min} to ${ACTION_TIME_LIMIT_MINUTES.max}; null or left out for the default ${ACTION_TIME_LIMIT_MINUTES.default}.`,
        ),
    }),
  }),
  z.object({
    ...head,
    kind: z
      .literal("test-target")
      .describe("Launches one of the Project's test targets, such as a Build to install."),
    settings: z.object({
      targetKey: z.string().describe("The key of the Project's test target it launches."),
    }),
  }),
  z.object({
    ...head,
    kind: z
      .literal("workflow")
      .describe(
        "Starts one of the repository's Workflows that declares a start by hand (workflow_dispatch), on the code host.",
      ),
    settings: z.object({
      file: z
        .string()
        .describe(
          "The Workflow's file by its name, as Work › CI lists it, such as release.yml, which the base branch has under .github/workflows/.",
        ),
      inputs: z
        .record(z.string(), z.string())
        .default({})
        .describe(
          "Its inputs by name, each as text (true or false for a yes-no), fixed with the Action and checked against what the file declares; an input left out takes its default.",
        ),
    }),
  }),
]);

/**
 * The Office tool whoever onboards Projects drafts a change to a Project's Actions with (spec
 * §2.15, "Defining Actions"), a Proposal the user applies with a click, all or nothing. Like every
 * Proposal tool it changes nothing itself, so it sits behind no Hard switch, and returns at once;
 * Projects refuses it while the Project has Actions switched off.
 */
@Injectable()
export class ActionOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly projects: ProjectService,
    private readonly actions: ProjectActions,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_ACTIONS_TOOL,
      description:
        "Drafts a change to a Project's Actions as a Proposal the user applies with a click, all or nothing: Actions to add or change by key, each given whole, and Actions to remove. It shows in this Thread as a card, with the values now and the ones proposed, and changes nothing until the user applies it. A value the user set changes only when changeUserSet names it. It may mark an Action Leaves the workstation, never clear the mark. It returns at once.",
      input: z.object({
        project: z.string().describe("The Project's id, as list_projects gives it."),
        actions: z
          .array(actionInput)
          .default([])
          .describe("Actions to add, or to change by their key, each whole."),
        removeActions: z
          .array(z.string())
          .optional()
          .describe("The keys of the Actions to remove; removing one removes its runs."),
        changeUserSet: z
          .array(z.string())
          .optional()
          .describe(
            "Each value the user set that this changes on purpose, as key.field, such as release.name; field is one of name, kind, settings and leavesTheWorkstation. Removing an Action changes each of its values. A value the user set that isn't named here is refused, so read the Actions first (list_projects) and name only what you mean to change.",
          ),
      }),
      run: async ({ project: projectId, actions, removeActions, changeUserSet }, { sessionId }) => {
        const project = await this.projects.find(projectId.trim());
        if (!project) return { text: `The Office has no Project "${projectId}".`, isError: true };
        return refusedToTheAgent(async () => {
          const changes = await this.proposed(project.id, {
            actions: actions satisfies readonly ActionFields[],
            removeActions,
            changeUserSet,
          });
          await this.proposals.draft(sessionId, {
            kind: "actions",
            projectId: project.id,
            changes,
          });
          return DRAFTED;
        });
      },
    });
  }

  private async proposed(
    projectId: string,
    given: Parameters<ProjectActions["propose"]>[1],
  ): ReturnType<ProjectActions["propose"]> {
    try {
      return await this.actions.propose(projectId, given);
    } catch (error) {
      // FeatureSwitchedOff is a ProjectRefused, so a switched-off Project is refused in its words.
      if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof ProjectNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}
