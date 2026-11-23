import type { Pipeline, ProjectPipeline } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  choiceById,
  defaultPipelineChoices,
  taskPipelineChoices,
  type PipelineChoiceGroup,
} from "./pipeline-choices.ts";

const FULL = {
  id: "full",
  name: "Full",
  description: "",
  stages: [{ name: "Implement" }, { name: "Tests" }],
} as unknown as Pipeline;

const QUICK_FIX = {
  id: "quick-fix",
  name: "Quick fix",
  description: "",
  stages: [{ name: "Implement" }],
} as unknown as Pipeline;

function projectPipeline(
  id: string,
  projectId: string,
  brokenBeforeUpdate: readonly string[] | null = null,
): ProjectPipeline {
  return {
    id,
    projectId,
    name: `${id} Pipeline`,
    description: "",
    stages: [{ name: "Implement" }, { name: "Verify on Linux" }],
    copiedFrom: { name: "Full", at: "2026-11-12T10:00:00.000Z" },
    brokenBeforeUpdate,
  } as unknown as ProjectPipeline;
}

const LINUX = projectPipeline("linux", "the-office");
const SPEC = projectPipeline("spec", "the-office", [
  "Changes Produce, which Document no longer had.",
]);
const ELSEWHERE = projectPipeline("elsewhere", "admin-panel");

const PROJECT = { id: "the-office", name: "the-office", defaultPipeline: "linux" };

function names(groups: readonly PipelineChoiceGroup[]): [string, string[]][] {
  return groups.map(({ label, choices }) => [label, choices.map(({ id }) => id)]);
}

describe("a Task's Pipeline choices", () => {
  it("lists the Project's default first, its other Project Pipelines, then the office-wide ones", () => {
    const groups = taskPipelineChoices(PROJECT, [FULL, QUICK_FIX], [SPEC, LINUX, ELSEWHERE]);

    expect(names(groups)).toEqual([
      ["the-office's Pipelines", ["linux", "spec"]],
      ["Office-wide Pipelines", ["full", "quick-fix"]],
    ]);
    expect(choiceById(groups, "linux")?.isDefault).toBe(true);
    expect(choiceById(groups, "spec")?.isDefault).toBe(false);
  });

  it("never offers another Project's Project Pipeline", () => {
    const groups = taskPipelineChoices(PROJECT, [FULL], [ELSEWHERE]);

    expect(names(groups)).toEqual([["Office-wide Pipelines", ["full"]]]);
  });

  it("puts an office-wide default first in its group, marked", () => {
    const groups = taskPipelineChoices(
      { ...PROJECT, defaultPipeline: "quick-fix" },
      [FULL, QUICK_FIX],
      [],
    );

    expect(names(groups)).toEqual([["Office-wide Pipelines", ["quick-fix", "full"]]]);
    expect(choiceById(groups, "quick-fix")?.isDefault).toBe(true);
  });

  it("reads a Project Pipeline's Stages and the Pipeline it was copied from", () => {
    const groups = taskPipelineChoices(PROJECT, [FULL], [LINUX]);

    expect(choiceById(groups, "linux")?.line).toBe(
      "Implement → Verify on Linux · copied from Full",
    );
    expect(choiceById(groups, "full")?.line).toBe("Implement → Tests");
    expect(choiceById(groups, "linux")?.brokenWhy).toBeUndefined();
  });

  it("lists one that was Broken before The Office updated with why, so it can't be chosen", () => {
    const spec = choiceById(taskPipelineChoices(PROJECT, [FULL], [SPEC]), "spec");

    expect(spec?.brokenWhy).toBe(
      "Broken before The Office updated: Changes Produce, which Document no longer had. Save it once in the-office's Pipelines to choose it.",
    );
  });
});

describe("a Project's default Pipeline choices", () => {
  it("lists the Project's own, then the office-wide ones, none marked", () => {
    const groups = defaultPipelineChoices(PROJECT, [FULL], [LINUX, ELSEWHERE]);

    expect(names(groups)).toEqual([
      ["the-office's Pipelines", ["linux"]],
      ["Office-wide Pipelines", ["full"]],
    ]);
    expect(groups.flatMap(({ choices }) => choices).some(({ isDefault }) => isDefault)).toBe(false);
  });
});
