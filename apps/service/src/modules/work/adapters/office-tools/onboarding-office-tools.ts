import { Injectable, type OnModuleInit } from "@nestjs/common";
import { markLabelFor, newProjectSchema, PROPOSE_PROJECT_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { ProposalRefused } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { ProjectRefused, type NewProject } from "../../../projects/index.js";
import { NewProjects } from "../../ports/new-projects.js";
import { ProposalDrafts, type ProposedProject } from "../../ports/proposal-drafts.js";
import type { OfficeToolResult } from "./work-tool-answers.js";

const DRAFTED =
  "The Proposal is in this Thread as a card with the Project as you drafted it; nothing is added until the user applies it, which clones it when it was given by its URL, then adds the Project and makes its Onboard Task on the Onboard Pipeline and starts it at once. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * What Devops drafts: a repository by its folder or by its Repository URL, whose clone's folder
 * The Office names; the mark is The Office's, from the name, as the Add a Project form starts it.
 */
const DRAFTED_PROJECT = newProjectSchema.omit({ mark: true, repositoryUrl: true, path: true });

const DRAFTED_INPUT = DRAFTED_PROJECT.extend({
  name: DRAFTED_PROJECT.shape.name.describe("The Project's name, as the user calls it."),
  path: z
    .string()
    .optional()
    .describe("The top-level folder of a repository on the workstation, as a full path."),
  url: z
    .string()
    .optional()
    .describe(
      "The Repository URL of a repository on a host instead, as read_repository read it; The Office clones it when the Proposal is applied.",
    ),
  baseBranch: DRAFTED_PROJECT.shape.baseBranch.describe(
    "The branch every Task branches from and publishes to.",
  ),
  installCommand: DRAFTED_PROJECT.shape.installCommand.describe(
    "The install command, one command line for the platform's shell.",
  ),
  commands: DRAFTED_PROJECT.shape.commands.describe(
    'The Project\'s commands, each with a key (lower-case letters, digits and "-", starting with a letter; not install or publish), a name, a kind (build, lint or test) and one command line. Give at least build, lint and test, as every Project starts with them.',
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
  features: z
    .object({
      "connected-devices": featureSwitch(
        "Connected devices: phones, emulators or boards the Agents install and drive the app on. On for an app that runs on a device, such as an Android app or embedded firmware (an AndroidManifest.xml, a Gradle Android plugin, a platformio.ini or a board's SDK); off for a web app, a service or a library. They work only once the Project's run environment is On.",
      ),
      "test-targets": featureSwitch(
        "Test targets: what a user tries by hand from a test instance, served or installed. On when the repository makes something to try, such as a web app it serves or an app it builds to install; off for a library or a tool with nothing to try by hand.",
      ),
      "github-issues": featureSwitch(
        "GitHub issues: importing the repository's issues as Tasks. On when the repository is on GitHub and its issues track the work (its Repository URL or its origin remote on github.com, with an issue template or issues in use); off for one on another host or whose work is tracked elsewhere.",
      ),
    })
    .optional()
    .describe(
      "Each of The Office's features the Project needs on or off, with why, as you judge from the repository with read_repository; a feature left out is added on. Run environment isn't one of them: it is asked when the Onboard Task starts.",
    ),
});

type DraftedProject = z.infer<typeof DRAFTED_INPUT>;

function featureSwitch(description: string) {
  return z
    .object({
      on: z.boolean().describe("Whether the feature is on for the Project."),
      reason: z
        .string()
        .min(1)
        .describe("Why, from the repository, in a short line the user reads on the card."),
    })
    .optional()
    .describe(description);
}

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
    private readonly projects: NewProjects,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_PROJECT_TOOL,
      description:
        "Drafts a new Project to onboard as a Proposal the user applies with a click: applying it adds the Project and its Onboard Task, in which you make it build and test in a fresh worktree. Give a repository on the workstation by its `path`, or one on a host by its Repository URL as `url`, which The Office clones when the Proposal is applied. Look at the repository first, with read_repository: its base branch among its branches, and the commands that install, build, lint and test it, reading a package's folder with its folder argument when they live below the top level, and what it makes, to judge which of The Office's features the Project needs (`features`): Connected devices for an app that runs on a device, such as an Android app or embedded firmware; Test targets for something a user tries by hand, served or installed; GitHub issues for a repository on GitHub whose issues track the work. Give each one on or off with a short reason. It shows in this Thread as a card and adds nothing until the user applies it. It returns at once.",
      input: DRAFTED_INPUT,
      run: async ({ features, ...given }, { sessionId }) =>
        drafted(() =>
          this.proposals.draft(sessionId, {
            kind: "project",
            project: this.projectOf(given),
            features: proposedFeatures(features),
            projectId: undefined,
            taskId: undefined,
          }),
        ),
    });
  }

  /** A repository on a host is drafted with the folder its clone will be in as its path. */
  private projectOf({ path, url, ...fields }: Omit<DraftedProject, "features">): NewProject {
    const mark: NewProject["mark"] = { label: markLabelFor(fields.name), colour: "teal" };
    if (path !== undefined && url === undefined) return { ...fields, path, mark };
    if (url !== undefined && path === undefined) {
      return { ...fields, path: this.projects.clonePathOf(url), repositoryUrl: url, mark };
    }
    throw new ProposalRefused([
      "Give the repository's path on the workstation or its Repository URL, one of the two.",
    ]);
  }
}

/** Only the features given, each with its reason trimmed. */
function proposedFeatures(given: DraftedProject["features"]): ProposedProject["features"] {
  return Object.fromEntries(
    Object.entries(given ?? {}).flatMap(([feature, proposed]) =>
      proposed ? [[feature, { on: proposed.on, reason: proposed.reason.trim() }]] : [],
    ),
  );
}

/** Drafts with `draft`, answering the Agent that it is drafted, or with why it was refused. */
async function drafted(draft: () => Promise<unknown>): Promise<OfficeToolResult> {
  try {
    await draft();
    return { text: DRAFTED, isError: false };
  } catch (error) {
    if (error instanceof ProposalRefused || error instanceof ProjectRefused) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
