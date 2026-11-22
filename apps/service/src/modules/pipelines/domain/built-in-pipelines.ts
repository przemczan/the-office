import {
  RUN_PROJECT_COMMAND_TOOL,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
} from "../../engine/index.js";
import { PROPOSE_ACTIONS_TOOL, PROPOSE_TEST_TARGETS_TOOL } from "../../conversations/index.js";
import type { DutyKey } from "../../people/index.js";
import type { Pipeline } from "./pipeline.js";
import { UPDATE_BRANCH_TOOL } from "./stage-commit.js";

/**
 * The duties built-in Agent Stages name, whose default holders are the Developer and Devops presets'
 * Roles: an Office with today's Roles runs them as before (spec §2.3, "Built-ins").
 */
const IMPLEMENTS: DutyKey = "implements";
const ONBOARDS_PROJECTS: DutyKey = "onboards-projects";

/** Onboarding's Pipeline, which onboarding uses and so can't be removed (spec §2.3). */
export const ONBOARD_PIPELINE = "onboard";

/** The Pipeline of a Project's "Set up the run environment" Task, which can't be removed either. */
export const SET_UP_RUN_ENVIRONMENT_PIPELINE = "set-up-run-environment";

/** The Pipeline of a Project's "Set up test targets" Task, which can't be removed either. */
export const SET_UP_TEST_TARGETS_PIPELINE = "set-up-test-targets";

/** The Pipeline of a Conflict resolution Task, which Work keys as `RESOLVE_CONFLICTS_PIPELINE`. */
export const RESOLVE_CONFLICTS_PIPELINE = "resolve-conflicts";

// A budget is checked against the whole Task's tokens (spec §2.3), so each Agent Stage's is the
// budgets of the Stages before it plus its own, written as that sum.

const full: Pipeline = {
  id: "full",
  name: "Full",
  description:
    "For a change that needs a careful look: implement, test, review in a fresh session, publish.",
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

const quickFix: Pipeline = {
  id: "quick-fix",
  name: "Quick fix",
  description: "For a small, obvious change: implement, test, publish.",
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

const document: Pipeline = {
  id: "document",
  name: "Document",
  description:
    "For a Task whose result is a document: produce it, then review it in a fresh session.",
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

const onboard: Pipeline = {
  id: ONBOARD_PIPELINE,
  name: "Onboard",
  description:
    "Prepares a Project on the workstation until it builds and tests in a fresh worktree, then publishes the fixes.",
  stages: [
    {
      kind: "agent",
      key: "onboard",
      name: "Onboard",
      duty: ONBOARDS_PROJECTS,
      brief: `Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with ${PROPOSE_ACTIONS_TOOL} the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.`,
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

const proofOfConcept: Pipeline = {
  id: "proof-of-concept",
  name: "Proof of concept",
  description:
    "For trying an idea out: implement, test, push the branch only, with no pull request and no merge.",
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

/**
 * Building the image and running the checks inside it come with the Script Stage's run environment;
 * until then Verify runs the Test command as any Script Stage does.
 */
const setUpRunEnvironment: Pipeline = {
  id: SET_UP_RUN_ENVIRONMENT_PIPELINE,
  name: "Set up run environment",
  description:
    "Writes a Project's run environment definition, .devcontainer/, for its stack, then publishes it.",
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

/**
 * A Conflict resolution Task's worktree holds the pull request's own branch: the Agent merges the
 * base into it, Test checks the result, and Publish pushes the branch, without force, to the same
 * pull request.
 */
const resolveConflicts: Pipeline = {
  id: RESOLVE_CONFLICTS_PIPELINE,
  name: "Resolve conflicts",
  description:
    "Merges the base branch into a pull request's branch, resolves the conflicts, tests, then pushes the branch to the same pull request.",
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

/**
 * Test targets are settings kept in The Office, not files (spec §2.12), so nothing is verified or
 * published: the Task is Done once the Agent has proposed them, and the user applies the Proposal.
 */
const setUpTestTargets: Pipeline = {
  id: SET_UP_TEST_TARGETS_PIPELINE,
  name: "Set up test targets",
  description:
    "Reads a Project's repository and proposes its test targets, for the user to apply; changes no file.",
  stages: [
    {
      kind: "agent",
      key: "set-up-test-targets",
      name: "Set up test targets",
      duty: ONBOARDS_PROJECTS,
      brief: `Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with ${PROPOSE_TEST_TARGETS_TOOL}, giving every target at once.`,
      session: "fresh",
      budget: 100_000,
      optional: false,
    },
  ],
};

/**
 * Spec §2.3's built-ins, in the library's order. The `pipelines` table's migration seeds them once;
 * from then on the library holds them and the user edits them like any.
 */
export const builtInPipelines: readonly Pipeline[] = [
  full,
  quickFix,
  document,
  onboard,
  proofOfConcept,
  setUpRunEnvironment,
  resolveConflicts,
  setUpTestTargets,
];
