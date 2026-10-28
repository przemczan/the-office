import { Injectable, type OnModuleInit } from "@nestjs/common";
import { markLabelFor, newProjectSchema, PROPOSE_PROJECT_TOOL } from "@the-office/contracts";
import { ProposalRefused } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { ProposalDrafts } from "../../ports/proposal-drafts.js";
import type { OfficeToolResult } from "./work-tool-answers.js";

const DRAFTED =
  "The Proposal is in this Thread as a card with the Project as you drafted it; nothing is added until the user applies it, which adds the Project and its Onboard Task, Ready on the Onboard Pipeline, for the user to start. Don't wait for it: tell the user what you propose and why, in a line or two.";

/** What Devops drafts; the mark is The Office's, from the name, as the Add a Project form starts it. */
const DRAFTED_PROJECT = newProjectSchema.omit({ mark: true });

/**
 * The Office tool Devops drafts a Project to onboard with (spec §2.1 Defaults), a Proposal the
 * user applies with a click. It changes nothing itself, so it sits behind no Hard switch, and
 * returns at once.
 */
@Injectable()
export class OnboardingOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalDrafts,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_PROJECT_TOOL,
      description:
        "Drafts a new Project to onboard as a Proposal the user applies with a click: applying it adds the Project and its Onboard Task, in which you make it build and test in a fresh worktree. Look at the repository first: its base branch, and the commands that install, build, lint and test it. It shows in this Thread as a card and adds nothing until the user applies it. It returns at once.",
      input: DRAFTED_PROJECT.extend({
        name: DRAFTED_PROJECT.shape.name.describe("The Project's name, as the user calls it."),
        path: DRAFTED_PROJECT.shape.path.describe(
          "The repository's top-level folder on the workstation, as a full path.",
        ),
        baseBranch: DRAFTED_PROJECT.shape.baseBranch.describe(
          "The branch every Task branches from and publishes to.",
        ),
        commands: DRAFTED_PROJECT.shape.commands.describe(
          "The install, build, lint and test commands, each one command line for the platform's shell.",
        ),
        installInputs: DRAFTED_PROJECT.shape.installInputs.describe(
          "Paths inside the repository whose change makes a worktree install again, such as its lockfile.",
        ),
        publishingMode: DRAFTED_PROJECT.shape.publishingMode.describe(
          "How Publish ships a Task's branch: pushed with a pull request opened, or merged.",
        ),
        defaultPipeline: DRAFTED_PROJECT.shape.defaultPipeline.describe(
          "The id of the Pipeline a new Task in it starts from, as list_pipelines gives it.",
        ),
      }),
      run: async (project, { sessionId }) =>
        drafted(() =>
          this.proposals.draft(sessionId, {
            kind: "project",
            project: { ...project, mark: { label: markLabelFor(project.name), colour: "teal" } },
            projectId: undefined,
            taskId: undefined,
          }),
        ),
    });
  }
}

/** Drafts with `draft`, answering the Agent that it is drafted, or with why it was refused. */
async function drafted(draft: () => Promise<unknown>): Promise<OfficeToolResult> {
  try {
    await draft();
    return { text: DRAFTED, isError: false };
  } catch (error) {
    if (error instanceof ProposalRefused) return { text: error.message, isError: true };
    throw error;
  }
}
