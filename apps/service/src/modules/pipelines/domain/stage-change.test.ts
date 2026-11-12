import { describe, expect, it } from "vitest";
import { buildStages, type BaseStages } from "./stage-change.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

const FULL: BaseStages = {
  name: "Full",
  stages: [
    agentStage(),
    scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } }),
    agentStage({ key: "review", name: "Review & fix", role: "reviewer" }),
  ],
};

const LINUX = scriptStage({ key: "linux", name: "Verify on Linux", command: "linux-check" });

function keysOf(stages: readonly { readonly key: string }[]): string[] {
  return stages.map(({ key }) => key);
}

describe("buildStages", () => {
  it("is the base Pipeline's Stages as they are without a Stage change", () => {
    const built = buildStages(FULL, []);

    expect(built.stages).toEqual(FULL.stages);
    expect(built.broken).toEqual([]);
    expect(built.rows.map(({ origin }) => origin)).toEqual(["base", "base", "base"]);
  });

  it("inserts a Stage before or after the Stage it names by key", () => {
    const before = buildStages(FULL, [{ kind: "insert-before", stageKey: "review", stage: LINUX }]);
    const after = buildStages(FULL, [{ kind: "insert-after", stageKey: "review", stage: LINUX }]);

    expect(keysOf(before.stages)).toEqual(["implement", "tests", "linux", "review"]);
    expect(keysOf(after.stages)).toEqual(["implement", "tests", "review", "linux"]);
    expect(after.rows[3]).toEqual({
      stage: LINUX,
      origin: "inserted",
      stageChangeIndexes: [0],
      baseStage: undefined,
      changedFields: [],
    });
    expect(after.broken).toEqual([]);
  });

  it("replaces a Stage with a whole new one, keeping the base Pipeline's beside it", () => {
    const built = buildStages(FULL, [{ kind: "replace", stageKey: "tests", stage: LINUX }]);

    expect(keysOf(built.stages)).toEqual(["implement", "linux", "review"]);
    expect(built.rows[1]).toMatchObject({ origin: "replaced", baseStage: FULL.stages[1] });
    expect(built.broken).toEqual([]);
  });

  it("changes only the fields a Change gives", () => {
    const built = buildStages(FULL, [
      { kind: "change", stageKey: "review", fields: { brief: "Review it twice.", effort: "high" } },
    ]);

    expect(built.stages[2]).toEqual({
      ...FULL.stages[2],
      brief: "Review it twice.",
      effort: "high",
    });
    expect(built.rows[2]).toMatchObject({ origin: "changed", changedFields: ["brief", "effort"] });
    expect(built.broken).toEqual([]);
  });

  it("removes a Stage, keeping its row where it was", () => {
    const built = buildStages(FULL, [{ kind: "remove", stageKey: "review" }]);

    expect(keysOf(built.stages)).toEqual(["implement", "tests"]);
    expect(built.rows.map(({ origin }) => origin)).toEqual(["base", "base", "removed"]);
    expect(built.broken).toEqual([]);
  });

  it("applies a Stage change to a Stage an earlier one inserted", () => {
    const built = buildStages(FULL, [
      { kind: "insert-after", stageKey: "review", stage: LINUX },
      { kind: "change", stageKey: "linux", fields: { optional: true } },
      { kind: "insert-before", stageKey: "linux", stage: gate() },
    ]);

    expect(keysOf(built.stages)).toEqual(["implement", "tests", "review", "gate", "linux"]);
    expect(built.stages[4]).toEqual({ ...LINUX, optional: true });
    expect(built.rows[4]).toMatchObject({ origin: "inserted", stageChangeIndexes: [0, 1] });
    expect(built.broken).toEqual([]);
  });

  it("is Broken when a Stage change names a key that isn't there, by the name it kept", () => {
    const built = buildStages(FULL, [
      { kind: "change", stageKey: "produce", stageName: "Produce", fields: { brief: "Write." } },
    ]);

    expect(built.stages).toEqual(FULL.stages);
    expect(built.broken).toEqual([
      {
        stageChangeIndex: 0,
        stageIndex: undefined,
        stageKey: "produce",
        text: "Changes Produce, which Full no longer has.",
      },
    ]);
  });

  it("is Broken when an inserted Stage's key is already there", () => {
    const built = buildStages(FULL, [
      { kind: "insert-after", stageKey: "review", stage: scriptStage({ name: "More tests" }) },
    ]);

    expect(built.stages).toEqual(FULL.stages);
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Inserts More tests after Review & fix, but Full now has a Stage of its own with the same key.",
    ]);
  });

  it("is Broken when a loop no longer goes back to an earlier built Stage", () => {
    const built = buildStages(FULL, [{ kind: "remove", stageKey: "implement" }]);

    expect(built.broken).toEqual([
      {
        stageChangeIndex: undefined,
        stageIndex: 0,
        stageKey: "tests",
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
    ]);
  });

  it("gives every reason at once, and the Stage changes that apply still do", () => {
    const built = buildStages(FULL, [
      { kind: "remove", stageKey: "produce", stageName: "Produce" },
      { kind: "insert-after", stageKey: "review", stage: LINUX },
      { kind: "insert-before", stageKey: "tests", stage: agentStage({ name: "Again" }) },
      { kind: "remove", stageKey: "implement" },
    ]);

    expect(keysOf(built.stages)).toEqual(["tests", "review", "linux"]);
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Removes Produce, which Full no longer has.",
      "Inserts Again before Tests, but Full now has a Stage of its own with the same key.",
      "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
    ]);
  });
});
