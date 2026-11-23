import { describe, expect, it } from "vitest";
import { missingCommandProblems, pipelineUse, removalProblems } from "./library-pipeline.js";
import { scriptStage } from "./stage.fixtures.js";

const PROJECTS = [
  {
    id: "site",
    name: "Site",
    defaultPipeline: "full",
    kindDefaultPipelines: { feature: null, bug: "quick-fix", chore: null },
    commands: [],
  },
  {
    id: "app",
    name: "App",
    defaultPipeline: "full",
    kindDefaultPipelines: { feature: null, bug: null, chore: null },
    commands: [],
  },
];

describe("a Pipeline a Kind's own default names", () => {
  it("counts as the Project's default, so it can't be removed", () => {
    const use = pipelineUse("quick-fix", PROJECTS, [], []);

    expect(use.defaultFor).toEqual([{ projectId: "site", name: "Site" }]);
    expect(removalProblems("quick-fix", use)).toContain(
      "It is the default Pipeline of Site; choose another default first.",
    );
  });

  it("must run in the Project, saying for which Kind", () => {
    const problems = missingCommandProblems(
      "quick-fix",
      [scriptStage({ command: "e2e" })],
      PROJECTS,
      [],
      [],
    );

    expect(problems.map((problem) => problem.text)).toEqual([
      expect.stringContaining("(it is its default Pipeline for Bugs)"),
    ]);
  });
});
