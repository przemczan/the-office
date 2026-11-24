import {
  RUN_PROJECT_COMMAND_TOOL,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
} from "../../engine/index.js";
import {
  CHANGE_ACTIONS_TOOL,
  CHANGE_PROJECT_COMMANDS_TOOL,
  CHANGE_TEST_TARGETS_TOOL,
  PROPOSE_ACTIONS_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_TEST_TARGETS_TOOL,
} from "../../conversations/index.js";
import type { DutyKey } from "../../people/index.js";
import {
  ONBOARD_PIPELINE,
  RESOLVE_CONFLICTS_PIPELINE,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
  SET_UP_TEST_TARGETS_PIPELINE,
} from "./built-in-pipelines.js";
import type { KeptPublishStage } from "./publish-stages.js";
import type { KeptStage } from "./routes-back.js";
import { UPDATE_BRANCH_TOOL } from "./stage-commit.js";

/**
 * The built-ins as the releases before routes had limits seeded them: plain lists of Stages, each
 * failure going back by its on-failure setting, publishing by a Script Stage running `publish`.
 * Stored Pipelines seeded then still read so.
 */
interface SeededPipeline {
  readonly id: string;
  readonly stages: readonly (KeptStage | KeptStage<KeptPublishStage>)[];
}

const IMPLEMENTS: DutyKey = "implements";
const ONBOARDS_PROJECTS: DutyKey = "onboards-projects";

const full: SeededPipeline = {
  id: "full",
  stages: [
    {
      kind: "agent",
      key: "implement",
      name: "Implement",
      duty: IMPLEMENTS,
      brief: "Implement the Plan until the Definition of Done is met.",
      session: "fresh",
      budget: 250_000,
      optional: false,
    },
    {
      kind: "script",
      key: "tests",
      name: "Tests",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "implement", rounds: 3 },
    },
    {
      kind: "agent",
      key: "review-and-fix",
      name: "Review & fix",
      duty: IMPLEMENTS,
      brief:
        "Review the diff against the Plan and the Definition of Done as if someone else wrote it, then fix what you find.",
      session: "fresh",
      budget: 250_000 + 120_000,
      optional: false,
      onFailure: { goBackTo: "implement", rounds: 1 },
    },
    {
      kind: "script",
      key: "publish",
      name: "Publish",
      command: "publish",
      optional: false,
      onFailure: { goBackTo: "review-and-fix", rounds: 1 },
    },
  ],
};

const quickFix: SeededPipeline = {
  id: "quick-fix",
  stages: [
    {
      kind: "agent",
      key: "implement",
      name: "Implement",
      duty: IMPLEMENTS,
      brief: "Make the smallest change that meets the Definition of Done.",
      session: "fresh",
      budget: 200_000,
      optional: false,
    },
    {
      kind: "script",
      key: "tests",
      name: "Tests",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "implement", rounds: 2 },
    },
    { kind: "script", key: "publish", name: "Publish", command: "publish", optional: false },
  ],
};

const document: SeededPipeline = {
  id: "document",
  stages: [
    {
      kind: "agent",
      key: "produce",
      name: "Produce",
      duty: IMPLEMENTS,
      brief: "Write what the Definition of Done asks for and attach it.",
      session: "fresh",
      budget: 80_000,
      optional: false,
    },
    {
      kind: "agent",
      key: "review-and-fix",
      name: "Review & fix",
      duty: IMPLEMENTS,
      brief: "Read the Attachment as its reader would and fix it.",
      session: "fresh",
      budget: 80_000 + 40_000,
      optional: false,
    },
  ],
};

const onboard: SeededPipeline = {
  id: ONBOARD_PIPELINE,
  stages: [
    {
      kind: "agent",
      key: "onboard",
      name: "Onboard",
      duty: ONBOARDS_PROJECTS,
      brief: `Make the Project build and test in a fresh worktree. Set its commands with ${CHANGE_PROJECT_COMMANDS_TOOL} when they are missing or wrong. Once its commands and test targets are set, add with ${CHANGE_ACTIONS_TOOL} the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with ${PROPOSE_PROJECT_COMMANDS_TOOL} and ${PROPOSE_ACTIONS_TOOL}; an Action that leaves the workstation is always proposed.`,
      session: "fresh",
      budget: 150_000,
      optional: false,
    },
    {
      kind: "script",
      key: "verify",
      name: "Verify",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "onboard", rounds: 2 },
    },
    { kind: "script", key: "publish", name: "Publish", command: "publish", optional: false },
  ],
};

const proofOfConcept: SeededPipeline = {
  id: "proof-of-concept",
  stages: [
    {
      kind: "agent",
      key: "implement",
      name: "Implement",
      duty: IMPLEMENTS,
      brief: "Make the smallest change that shows the idea works and meets the Definition of Done.",
      session: "fresh",
      budget: 200_000,
      optional: false,
    },
    {
      kind: "script",
      key: "tests",
      name: "Tests",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "implement", rounds: 2 },
    },
    {
      kind: "script",
      key: "publish",
      name: "Publish",
      command: "publish",
      publishTarget: "branch-only",
      optional: false,
    },
  ],
};

const setUpRunEnvironment: SeededPipeline = {
  id: SET_UP_RUN_ENVIRONMENT_PIPELINE,
  stages: [
    {
      kind: "agent",
      key: "set-up",
      name: "Set up",
      duty: ONBOARDS_PROJECTS,
      brief: `Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project's stack, from its manifests and commands, with ${WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL}: it checks the files and writes them only when they are valid. Write and Edit can't reach .devcontainer/.`,
      session: "fresh",
      budget: 150_000,
      optional: false,
    },
    {
      kind: "script",
      key: "verify",
      name: "Verify",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "set-up", rounds: 2 },
    },
    { kind: "script", key: "publish", name: "Publish", command: "publish", optional: false },
  ],
};

const resolveConflicts: SeededPipeline = {
  id: RESOLVE_CONFLICTS_PIPELINE,
  stages: [
    {
      kind: "agent",
      key: "resolve-conflicts",
      name: "Resolve conflicts",
      duty: IMPLEMENTS,
      brief: `Call ${UPDATE_BRANCH_TOOL} to merge the base branch into this branch: a merge, never a rebase. Resolve each conflicted file keeping what both sides meant, and remove every conflict marker. Run the Test with ${RUN_PROJECT_COMMAND_TOOL} test and fix what it finds. When you can't finish, end the Stage failed and write why in the Handover note.`,
      session: "fresh",
      budget: 150_000,
      optional: false,
    },
    {
      kind: "script",
      key: "test",
      name: "Test",
      command: "test",
      optional: false,
      onFailure: { goBackTo: "resolve-conflicts", rounds: 2 },
    },
    {
      kind: "script",
      key: "publish",
      name: "Publish",
      command: "publish",
      publishTarget: "branch-only",
      optional: false,
    },
  ],
};

const setUpTestTargets: SeededPipeline = {
  id: SET_UP_TEST_TARGETS_PIPELINE,
  stages: [
    {
      kind: "agent",
      key: "set-up-test-targets",
      name: "Set up test targets",
      duty: ONBOARDS_PROJECTS,
      brief: `Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with ${CHANGE_TEST_TARGETS_TOOL}, giving every target at once, or with ${PROPOSE_TEST_TARGETS_TOOL} without it.`,
      session: "fresh",
      budget: 100_000,
      optional: false,
    },
  ],
};

/** The built-ins seeded before routes had limits, in the library's order. */
export const builtInPipelinesBeforeFlows: readonly SeededPipeline[] = [
  full,
  quickFix,
  document,
  onboard,
  proofOfConcept,
  setUpRunEnvironment,
  resolveConflicts,
  setUpTestTargets,
];
