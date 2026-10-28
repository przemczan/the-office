import type { Pipeline } from "./pipeline.js";

/** The Roles the Developer and Devops presets are hired into, keyed as People keys them. */
const DEVELOPER = "developer";
const DEVOPS = "devops";

/** Onboarding's Pipeline, which onboarding uses and so can't be removed (spec §2.3). */
export const ONBOARD_PIPELINE = "onboard";

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
      role: DEVELOPER,
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
      role: DEVELOPER,
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
      role: DEVELOPER,
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
      role: DEVELOPER,
      brief: "Write what the Definition of Done asks for and attach it.",
      session: "fresh",
      budget: 80_000,
      optional: false,
    },
    {
      kind: "agent",
      key: "review-and-fix",
      name: "Review & fix",
      role: DEVELOPER,
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
    "Prepares a Project on the workstation until it builds and tests in a fresh worktree.",
  stages: [
    {
      kind: "agent",
      key: "onboard",
      name: "Onboard",
      role: DEVOPS,
      brief:
        "Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.",
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
  ],
};

// Its Publish pushes the branch only from task 24's step 3, which adds a Publish Stage's target;
// until then it publishes by the Project's publishing mode like the others.
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
      role: DEVELOPER,
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
    { kind: "script", key: "publish", name: "Publish", command: "publish", optional: false },
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
];
