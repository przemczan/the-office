import type { Pipeline } from "./pipeline.js";

/** The Role the Developer preset is hired into; People (task 08) keys it the same way. */
const DEVELOPER = "developer";

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
      budget: 100_000,
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

/** Full, Quick fix and Document (spec §2.3), the library until its editor arrives in tier 2. */
export const builtInPipelines: readonly Pipeline[] = [full, quickFix, document];
