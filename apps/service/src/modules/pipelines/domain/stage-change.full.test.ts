import { describe, expect, it } from "vitest";
import { buildStages, emptyChangeIndexes, type BaseStages } from "./stage-change.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

const DOCUMENT: BaseStages = {
  name: "Document",
  stages: [
    agentStage({ key: "produce", name: "Produce", effort: "high" }),
    scriptStage({
      key: "check",
      name: "Glossary check",
      onFailure: { goBackTo: "produce", rounds: 2 },
    }),
  ],
};

describe("buildStages, field by field", () => {
  it("clears an optional field a Change gives as null", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "change", stageKey: "produce", fields: { effort: null } },
      { kind: "change", stageKey: "check", fields: { onFailure: null } },
    ]);

    expect(built.stages[0]).not.toHaveProperty("effort");
    expect(built.stages[1]).not.toHaveProperty("onFailure");
    expect(built.broken).toEqual([]);
  });

  it("skips a field the Stage's kind no longer has and is Broken, applying the rest", () => {
    const base = {
      ...DOCUMENT,
      stages: [DOCUMENT.stages[0]!, scriptStage({ key: "review", name: "Review" })],
    };

    const built = buildStages(base, [
      {
        kind: "change",
        stageKey: "review",
        stageName: "Review",
        fields: { brief: "Look twice.", role: "reviewer", name: "Review twice" },
      },
    ]);

    expect(built.stages[1]).toEqual(scriptStage({ key: "review", name: "Review twice" }));
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Changes Brief, Role of Review, which is now a Script Stage.",
    ]);
  });

  it("lets a Replace keep the key it replaces, and refuses one taking another Stage's", () => {
    const kept = buildStages(DOCUMENT, [
      { kind: "replace", stageKey: "check", stage: gate({ key: "check", name: "Look at it" }) },
    ]);
    const taken = buildStages(DOCUMENT, [
      { kind: "replace", stageKey: "check", stage: gate({ key: "produce", name: "Look at it" }) },
    ]);

    expect(kept.stages[1]).toEqual(gate({ key: "check", name: "Look at it" }));
    expect(kept.broken).toEqual([]);
    expect(taken.broken.map(({ text }) => text)).toEqual([
      "Replaces Glossary check with Look at it, but Document now has a Stage of its own with the same key.",
    ]);
  });

  it("names a Stage change's Stage as it is now, and keeps the name it had once it is gone", () => {
    const renamed = { ...DOCUMENT, stages: [{ ...DOCUMENT.stages[0]!, name: "Write" }] };

    const built = buildStages(renamed, [
      { kind: "change", stageKey: "produce", stageName: "Produce", fields: { brief: "Write." } },
      { kind: "remove", stageKey: "check", stageName: "Glossary check" },
    ]);

    expect(built.stageChanges.map(({ stageName }) => stageName)).toEqual([
      "Write",
      "Glossary check",
    ]);
  });

  it("says a key an edit names isn't among the Stages, when it kept no name", () => {
    const built = buildStages(DOCUMENT, [{ kind: "remove", stageKey: "nowhere" }]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Removes nowhere, which isn't among the Stages.",
    ]);
  });

  it("says a Stage an earlier Stage change removed is gone by that Stage change, not the base Pipeline", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "remove", stageKey: "check", stageName: "Glossary check" },
      {
        kind: "change",
        stageKey: "check",
        stageName: "Glossary check",
        fields: { brief: "Look." },
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      expect.stringMatching(/, which an earlier Stage change removes\.$/),
    ]);
  });
});

describe("buildStages, the rules on the built Stages", () => {
  it("is Broken when the base Pipeline renames a Stage to an inserted one's name", () => {
    const base = { ...DOCUMENT, stages: [{ ...DOCUMENT.stages[0]!, name: "Write" }] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "produce",
        stage: agentStage({ key: "write", name: "Write" }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      'Stage 2 · Write: another Stage is named "Write".',
    ]);
  });

  it("is Broken when the Stage before an inserted one that continues its session changes Role", () => {
    const base = { ...DOCUMENT, stages: [{ ...agentStage(), role: "writer" }] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "implement",
        stage: agentStage({ key: "polish", name: "Polish", session: "continue" }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Stage 2 · Polish: continuing a session needs the same Role in the Stage before.",
    ]);
  });

  it("is Broken when the Stage an inserted one loops back to becomes a Gate", () => {
    const base = { ...DOCUMENT, stages: [gate({ key: "produce", name: "Produce" })] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "produce",
        stage: scriptStage({ onFailure: { goBackTo: "produce", rounds: 1 } }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Stage 2 · Tests: on failure it can't go back to a Gate.",
    ]);
  });

  it("is Broken with nothing left to run", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "remove", stageKey: "produce" },
      { kind: "remove", stageKey: "check" },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual(["A Pipeline needs at least one Stage."]);
  });
});

describe("emptyChangeIndexes", () => {
  it("finds the Changes that give no field", () => {
    expect(
      emptyChangeIndexes([
        { kind: "change", stageKey: "produce", fields: { brief: "Write." } },
        { kind: "change", stageKey: "check", fields: {} },
        { kind: "remove", stageKey: "check" },
      ]),
    ).toEqual([1]);
  });
});
