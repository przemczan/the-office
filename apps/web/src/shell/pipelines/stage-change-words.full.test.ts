import type { BuiltStage, Duty, ProjectPipeline, Role, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import type { StageChangeRow } from "./stage-change-edits.ts";
import {
  builtOnByWords,
  fieldWords,
  getsLine,
  originWords,
  projectPipelineLine,
  stageChangeLine,
  undoWords,
} from "./stage-change-words.ts";

const IMPLEMENT: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};

const ROLES = [{ key: "developer", card: { name: "Jim" } }] as unknown as Role[];

function row(
  built: Partial<BuiltStage>,
  stageChange?: StageChangeRow["stageChange"],
): StageChangeRow {
  return {
    built: {
      stage: IMPLEMENT,
      origin: "base",
      stageChangeIndexes: [],
      baseStage: IMPLEMENT,
      changedFields: [],
      ...built,
    },
    number: 1,
    stageChange,
    broken: [],
    problems: [],
    warnings: [],
  };
}

describe("a row's mark and its Undo", () => {
  it("reads From the base Pipeline, or what the Stage change did", () => {
    expect(originWords(row({}), "Full")).toEqual({ tone: "plain", text: "From Full" });
    expect(
      originWords(
        row(
          { origin: "inserted", baseStage: null },
          {
            kind: "insert-after",
            stageKey: "review",
            stageName: "Review & fix",
            stage: IMPLEMENT,
          },
        ),
        "Full",
      ).text,
    ).toBe("Inserted after Review & fix");
    expect(
      originWords(row({ origin: "changed", changedFields: ["brief", "effort"] }), "Full"),
    ).toEqual({
      tone: "warning",
      text: "Changed: Brief, Effort",
    });
    expect(originWords(row({ origin: "removed" }), "Full").text).toBe("Removed");
  });

  it("says what Undo gives back", () => {
    expect(
      undoWords(
        row(
          { origin: "removed" },
          { kind: "remove", stageKey: "implement", stageName: "Implement" },
        ),
        "Full",
      ),
    ).toBe("Undo: put Full's Implement back");
    expect(undoWords(row({ origin: "changed" }), "Full")).toBe(
      "Undo: back to Full's Implement as it is",
    );
  });
});

describe("a Change's fields beside the base Pipeline's values", () => {
  it("reads each field as the Stage form does", () => {
    const context = { roles: ROLES, stages: [IMPLEMENT] };
    const changed: Stage = { ...IMPLEMENT, effort: "high", budget: 300_000 };
    expect(fieldWords(IMPLEMENT, "effort", context)).toBe("Role default");
    expect(fieldWords(changed, "effort", context)).toBe("High");
    expect(fieldWords(changed, "budget", context)).toBe("300k tokens");
    expect(fieldWords(IMPLEMENT, "role", context)).toBe("Jim");
    expect(fieldWords(IMPLEMENT, "onFailure", context)).toBe("Ask you");
  });

  it("reads a duty with its holder", () => {
    const duties = [
      { key: "reviews", holder: { roleKey: "developer", name: "Jim", title: "Developer" } },
    ] as Duty[];
    const reviewing: Stage = { ...IMPLEMENT, role: undefined, duty: "reviews" };
    const context = { roles: ROLES, duties, stages: [reviewing] };
    expect(fieldWords(reviewing, "duty", context)).toBe("Reviews · Jim");
    expect(fieldWords(reviewing, "duty", { roles: ROLES, stages: [reviewing] })).toBe(
      "Reviews · nobody yet",
    );
    expect(fieldWords(IMPLEMENT, "duty", context)).toBe("Jim");
  });

  it("names a Stage change in a line", () => {
    expect(
      stageChangeLine({
        kind: "change",
        stageKey: "implement",
        stageName: "Implement",
        fields: { brief: "x", budget: 1000 },
      }),
    ).toBe("Changes Implement: Brief, Budget");
    expect(
      stageChangeLine({
        kind: "change",
        stageKey: "implement",
        stageName: "Implement",
        fields: { duty: "implements" },
      }),
    ).toBe("Changes Implement: Duty");
  });
});

describe("the lines that count", () => {
  it("counts what the Project gets", () => {
    expect(getsLine(5, 4, "Full", 2)).toBe("5 Stages: Full's 4, with 2 Stage changes");
    expect(getsLine(4, 4, "Full", 0)).toBe("Full's 4 Stages as they are: no Stage change yet");
    expect(builtOnByWords(1)).toBe("Built on by 1 Project Pipeline");
  });

  it("says what a Project Pipeline is built from, or how many Stage changes don't apply", () => {
    const projectPipeline = {
      basePipeline: { id: "full", name: "Full" },
      stageChanges: [{}],
      broken: [],
    } as unknown as ProjectPipeline;
    expect(projectPipelineLine(projectPipeline)).toBe("Built from Full · 1 Stage change");
    expect(projectPipelineLine({ ...projectPipeline, broken: [{}, {}] } as ProjectPipeline)).toBe(
      "Built from Full · 2 Stage changes don't apply",
    );
  });
});
