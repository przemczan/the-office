import type { Proposal, ProposedRoutes, Route, Stage } from "@the-office/contracts";

/**
 * Devops' Proposal of Full's routes, as docs/design/README.md's example has it: Tests goes to
 * Review & fix only when Implement changed files, otherwise to Publish; Review & fix goes to a new
 * Verify on Linux instead of Docs, which it removes.
 */

function script(key: string, name: string, column: number, routes: readonly Route[]): Stage {
  return {
    kind: "script",
    key,
    name,
    command: key,
    optional: false,
    place: { column, row: 0 },
    routes: [...routes],
  };
}

const always = (to: string | null): Route => ({ to, condition: null });

const WHEN_IMPLEMENT_CHANGED: Route = {
  to: "review",
  condition: { combine: "all", tests: [{ kind: "stage", stage: "implement", is: "changed" }] },
};

const IMPLEMENT = script("implement", "Implement", 0, [always("tests")]);
const PUBLISH = script("publish", "Publish", 4, [always(null)]);

/** Full as it is. */
export const FULL_NOW: readonly Stage[] = [
  IMPLEMENT,
  script("tests", "Tests", 1, [always("review")]),
  script("review", "Review & fix", 2, [always("docs")]),
  script("docs", "Docs", 3, [always("publish")]),
  PUBLISH,
];

/** Full as proposed. */
export const FULL_PROPOSED: readonly Stage[] = [
  IMPLEMENT,
  script("tests", "Tests", 1, [WHEN_IMPLEMENT_CHANGED, always("publish")]),
  script("review", "Review & fix", 2, [always("linux")]),
  script("linux", "Verify on Linux", 3, [always("publish")]),
  PUBLISH,
];

export const FULL_ROUTES: ProposedRoutes = {
  stages: [
    {
      stageKey: "tests",
      stageName: "Tests",
      from: [always("review")],
      to: [WHEN_IMPLEMENT_CHANGED, always("publish")],
    },
    {
      stageKey: "review",
      stageName: "Review & fix",
      from: [always("docs")],
      to: [always("linux")],
    },
    { stageKey: "linux", stageName: "Verify on Linux", from: [], to: [always("publish")] },
    { stageKey: "docs", stageName: "Docs", from: [always("publish")], to: [] },
  ],
  check: [],
};

export const ROUTES_PROPOSAL_ID = "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0b01";

export const ROUTES_PROPOSAL: Proposal = {
  id: ROUTES_PROPOSAL_ID,
  threadId: "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0b02",
  draftedBy: "devops",
  draftedAt: "2026-11-18T10:00:00.000Z",
  change: {
    kind: "pipeline",
    pipelineId: "full",
    from: [...FULL_NOW],
    to: [...FULL_PROPOSED],
    routes: FULL_ROUTES,
  },
  status: { kind: "open" },
};

export const PROJECT_ROUTES_PROPOSAL_ID = "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0b03";

const FULL_FOR_THE_OFFICE = {
  name: "Full for the-office",
  description: "",
  basePipelineId: "full",
};

/** Devops' Proposal of the same routes on the-office's Project Pipeline built on Full. */
export const PROJECT_ROUTES_PROPOSAL: Proposal = {
  ...ROUTES_PROPOSAL,
  id: PROJECT_ROUTES_PROPOSAL_ID,
  change: {
    kind: "project-pipeline",
    projectId: "the-office",
    pipelineId: "pp-full",
    from: { ...FULL_FOR_THE_OFFICE, stageChanges: [] },
    to: {
      ...FULL_FOR_THE_OFFICE,
      stageChanges: FULL_ROUTES.stages
        .filter(({ to }) => to.length > 0)
        .map(({ stageKey, stageName, to }) => ({
          kind: "change-routes",
          stageKey,
          stageName,
          routes: to,
        })),
    },
    routes: FULL_ROUTES,
  },
};
