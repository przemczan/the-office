import { describe, expect, it } from "vitest";
import { taskPipelineProblems, type PipelineCommands } from "./pipeline-commands.js";

const ADMIN_PANEL = {
  id: "admin-panel",
  name: "Admin panel",
  commands: [{ key: "test" }, { key: "lint" }],
};

const OWN: PipelineCommands = {
  name: "Full for Admin panel",
  keys: ["test"],
  hasGate: true,
  projectId: "admin-panel",
  broken: [],
};

function problemsOf(pipeline: PipelineCommands | undefined, ownerName?: string): string[] {
  return taskPipelineProblems(
    { pipelineId: "chosen", pipeline, ownerName, choices: ["full-for-admin", "full"] },
    ADMIN_PANEL,
  );
}

describe("taskPipelineProblems", () => {
  it("passes an office-wide Pipeline and the Project's own, its commands all there", () => {
    expect(problemsOf({ name: "Full", keys: ["lint"], hasGate: true, broken: [] })).toEqual([]);
    expect(problemsOf(OWN)).toEqual([]);
  });

  it("refuses an unknown one, listing what the Project can choose", () => {
    expect(problemsOf(undefined)).toEqual([
      'There is no Pipeline "chosen". Admin panel can choose full-for-admin, full.',
    ]);
  });

  it("refuses another Project's Project Pipeline, naming whose it is", () => {
    expect(problemsOf({ ...OWN, name: "Full for Shop", projectId: "shop" }, "Shop")).toEqual([
      "Full for Shop is a Project Pipeline of Shop: only Shop's Tasks can follow it.",
    ]);
  });

  it("refuses a Broken one with each reason and where it is fixed, before its commands", () => {
    const broken = {
      ...OWN,
      keys: ["e2e"],
      broken: [
        "Changes Produce, which Document no longer has.",
        "Glossary check goes back to Produce on failure, which isn't among the Stages any more.",
      ],
    };

    expect(problemsOf(broken)).toEqual([
      "Full for Admin panel is Broken: Changes Produce, which Document no longer has. Glossary check goes back to Produce on failure, which isn't among the Stages any more. Fix its Stage changes in Admin panel's Pipelines, or choose another Pipeline.",
    ]);
  });

  it("refuses one whose built Stages run a command the Project lacks", () => {
    expect(problemsOf({ ...OWN, keys: ["test", "e2e"] })).toEqual([
      "The Pipeline Full for Admin panel runs e2e, which Admin panel has no command for. Add it on the Project page, or choose another Pipeline.",
    ]);
  });
});
