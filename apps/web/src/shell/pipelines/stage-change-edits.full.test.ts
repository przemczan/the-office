import type { BuiltStage, Stage, StageChange } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  insertPlace,
  newStageAmong,
  stageChangesShown,
  stageDrafted,
  withFieldSetBack,
  withOwnKey,
  withStageChangeAppliedTo,
  withStageEdited,
  withStageInserted,
  withStageRemoved,
  withStageReplaced,
  withoutStageChange,
  withoutStageChangeOf,
} from "./stage-change-edits.ts";

const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const REVIEW: Stage = {
  kind: "agent",
  key: "review",
  name: "Review & fix",
  optional: false,
  role: "developer",
  brief: "Review it.",
  session: "fresh",
  budget: 200_000,
  onFailure: { goBackTo: "tests", rounds: 2 },
};
const PUBLISH: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const LINUX: Stage = {
  kind: "script",
  key: "verify-on-linux",
  name: "Verify on Linux",
  optional: false,
  command: "verify-linux",
};

function fromBase(stage: Stage): BuiltStage {
  return { stage, origin: "base", stageChangeIndexes: [], baseStage: stage, changedFields: [] };
}

const INSERT_LINUX: StageChange = {
  kind: "insert-after",
  stageKey: "review",
  stageName: "Review & fix",
  stage: LINUX,
};

describe("the rows of what the Project gets", () => {
  it("marks each row by the Stage change that makes it, numbering the Stages a Task gets", () => {
    const remove: StageChange = { kind: "remove", stageKey: "tests", stageName: "Tests" };
    const rows: BuiltStage[] = [
      { ...fromBase(TESTS), origin: "removed", stageChangeIndexes: [1] },
      fromBase(REVIEW),
      {
        stage: LINUX,
        origin: "inserted",
        stageChangeIndexes: [0],
        baseStage: null,
        changedFields: [],
      },
      fromBase(PUBLISH),
    ];
    const shown = stageChangesShown({ rows, broken: [] }, [INSERT_LINUX, remove]);
    expect(shown.rows.map(({ number, stageChange }) => [number, stageChange?.kind])).toEqual([
      [undefined, "remove"],
      [1, undefined],
      [2, "insert-after"],
      [3, undefined],
    ]);
  });

  it("puts a Stage change whose Stage is gone apart, with the service's reason and its fix", () => {
    const change: StageChange = {
      kind: "change",
      stageKey: "produce",
      stageName: "Produce",
      fields: { brief: "Write it." },
    };
    const reason = {
      stageChangeIndex: 0,
      stageIndex: null,
      stageKey: "produce",
      text: "Changes Produce, which Document no longer has.",
    };
    const shown = stageChangesShown(
      { rows: [fromBase(REVIEW)], broken: [reason] },
      [change],
      [{ stageIndex: null, text: reason.text }],
    );
    expect(shown.notApplying).toEqual([
      { index: 0, stageChange: change, why: reason.text, fix: "apply-to" },
    ]);
    // Shown where it is, never twice among the problems.
    expect(shown.problems).toEqual([]);
    expect(withStageChangeAppliedTo([change], 0, REVIEW)).toEqual([
      { ...change, stageKey: "review", stageName: "Review & fix" },
    ]);
  });

  it("gives an inserted Stage whose key the base Pipeline took a key of its own", () => {
    const taken = { ...INSERT_LINUX, stage: { ...LINUX, key: "publish" } };
    const rows = [fromBase(REVIEW), fromBase(PUBLISH)];
    const shown = stageChangesShown(
      {
        rows,
        broken: [{ stageChangeIndex: 0, stageIndex: null, stageKey: "review", text: "taken" }],
      },
      [taken],
    );
    expect(shown.notApplying[0]?.fix).toBe("own-key");
    const [fixed] = withOwnKey([taken], 0, rows);
    expect(fixed?.kind === "insert-after" && fixed.stage.key).toBe("verify-on-linux");
  });

  it("flags a loop whose target is gone on its row", () => {
    const loop = {
      stageChangeIndex: null,
      stageIndex: 1,
      stageKey: "review",
      text: "Review & fix goes back to Tests on failure, which isn't among the Stages.",
    };
    const shown = stageChangesShown(
      { rows: [fromBase(PUBLISH), fromBase(REVIEW)], broken: [loop] },
      [],
    );
    expect(shown.rows.map(({ broken }) => broken)).toEqual([[], [loop]]);
  });
});

/** Review & fix as a Change of `fields` makes it. */
function changed(fields: Partial<Stage>): BuiltStage {
  return {
    ...fromBase(REVIEW),
    stage: { ...REVIEW, ...fields } as Stage,
    origin: "changed",
    stageChangeIndexes: [0],
    changedFields: Object.keys(fields),
  };
}

describe("Stage changes made in the editor", () => {
  it("drops a field edited back to the base Pipeline's value, and the Change once it is empty", () => {
    const once = withStageEdited([], fromBase(REVIEW), {
      ...REVIEW,
      brief: "Read closely.",
      budget: 300_000,
    });
    const back = withStageEdited(once, changed({ brief: "Read closely.", budget: 300_000 }), {
      ...REVIEW,
      brief: "Read closely.",
    });
    expect(back).toEqual([
      {
        kind: "change",
        stageKey: "review",
        stageName: "Review & fix",
        fields: { brief: "Read closely." },
      },
    ]);
    expect(withStageEdited(back, changed({ brief: "Read closely." }), REVIEW)).toEqual([]);
  });

  it("clears an optional field the base Stage has with null", () => {
    const { onFailure: _onFailure, ...asksYou } = REVIEW;
    expect(withStageEdited([], fromBase(REVIEW), asksYou as Stage)).toEqual([
      {
        kind: "change",
        stageKey: "review",
        stageName: "Review & fix",
        fields: { onFailure: null },
      },
    ]);
  });

  it("sets one field back, keeping the others of the Change", () => {
    const stageChanges = withStageEdited([], fromBase(REVIEW), {
      ...REVIEW,
      brief: "Read closely.",
      budget: 300_000,
    });
    expect(
      withFieldSetBack(
        stageChanges,
        changed({ brief: "Read closely.", budget: 300_000 }),
        "budget",
      ),
    ).toEqual([
      {
        kind: "change",
        stageKey: "review",
        stageName: "Review & fix",
        fields: { brief: "Read closely." },
      },
    ]);
  });

  it("edits an inserted Stage in its own Stage change", () => {
    const inserted: BuiltStage = {
      stage: LINUX,
      origin: "inserted",
      stageChangeIndexes: [0],
      baseStage: null,
      changedFields: [],
    };
    expect(withStageEdited([INSERT_LINUX], inserted, { ...LINUX, optional: true })).toEqual([
      { ...INSERT_LINUX, stage: { ...LINUX, optional: true } },
    ]);
  });

  it("inserts after the Stage above the insert point, or before the first, with a key of its own", () => {
    const rows = [fromBase(TESTS), fromBase(REVIEW)];
    expect(insertPlace(rows, 0)).toEqual({ kind: "insert-before", stage: TESTS });
    const place = insertPlace(rows, 2);
    expect(place).toEqual({ kind: "insert-after", stage: REVIEW });
    const gate = newStageAmong(rows, "gate", []);
    expect(gate).toMatchObject({ kind: "gate", key: "gate", name: "Gate" });
    expect(place && withStageInserted([], place, gate)).toEqual([
      { kind: "insert-after", stageKey: "review", stageName: "Review & fix", stage: gate },
    ]);
  });

  it("replaces a Stage under its own key and removes one, a Change of it going with it", () => {
    const rows = [fromBase(TESTS), changed({ brief: "Read closely." })];
    const withChange = withStageEdited([], fromBase(REVIEW), { ...REVIEW, brief: "Read closely." });
    const [replace] = withStageReplaced(withChange, rows, rows[1] as BuiltStage, "gate");
    expect(replace).toMatchObject({
      kind: "replace",
      stageKey: "review",
      stage: { kind: "gate", key: "review" },
    });
    expect(withStageRemoved(withChange, rows[1] as BuiltStage)).toEqual([
      { kind: "remove", stageKey: "review", stageName: "Review & fix" },
    ]);
  });

  it("undoes one Stage change alone, and an insert with what later named the Stage it inserted", () => {
    const remove: StageChange = { kind: "remove", stageKey: "tests", stageName: "Tests" };
    const changeLinux: StageChange = {
      kind: "change",
      stageKey: "verify-on-linux",
      stageName: "Verify on Linux",
      fields: { optional: true },
    };
    const stageChanges = [INSERT_LINUX, remove, changeLinux];
    const removed: BuiltStage = { ...fromBase(TESTS), origin: "removed", stageChangeIndexes: [1] };
    const inserted: BuiltStage = {
      stage: LINUX,
      origin: "inserted",
      stageChangeIndexes: [0, 2],
      baseStage: null,
      changedFields: [],
    };
    expect(withoutStageChangeOf(stageChanges, removed)).toEqual([INSERT_LINUX, changeLinux]);
    expect(withoutStageChangeOf(stageChanges, inserted)).toEqual([remove]);
    expect(withoutStageChange(stageChanges, 1)).toEqual([INSERT_LINUX, changeLinux]);
  });

  it("undoes an insert with the whole chain of Stages inserted beside the Stages it brought", () => {
    const smoke: Stage = { ...TESTS, key: "smoke", name: "Smoke" };
    const insertSmoke: StageChange = {
      kind: "insert-after",
      stageKey: "verify-on-linux",
      stageName: "Verify on Linux",
      stage: smoke,
    };
    const changeSmoke: StageChange = {
      kind: "change",
      stageKey: "smoke",
      stageName: "Smoke",
      fields: { optional: true },
    };
    const remove: StageChange = { kind: "remove", stageKey: "tests", stageName: "Tests" };
    const inserted: BuiltStage = {
      stage: LINUX,
      origin: "inserted",
      stageChangeIndexes: [0],
      baseStage: null,
      changedFields: [],
    };
    expect(
      withoutStageChangeOf([INSERT_LINUX, remove, insertSmoke, changeSmoke], inserted),
    ).toEqual([remove]);
  });

  it("keys a new Stage apart from a Stage change's Stage that doesn't apply", () => {
    const notApplying: StageChange = {
      kind: "insert-after",
      stageKey: "lint",
      stageName: "Lint",
      stage: { kind: "gate", key: "gate", name: "Gate", optional: false },
    };
    const gate = newStageAmong([fromBase(TESTS)], "gate", [notApplying]);
    expect(gate.key).not.toBe("gate");
  });
});

describe("the Stage the Stage form shows", () => {
  it("is the base Stage with the Change being edited, before the check answers", () => {
    const change: StageChange = {
      kind: "change",
      stageKey: "review",
      stageName: "Review & fix",
      fields: { name: "Review", onFailure: null },
    };
    const { onFailure: _cleared, ...withoutLoop } = REVIEW;
    expect(stageDrafted([change], fromBase(REVIEW))).toEqual({ ...withoutLoop, name: "Review" });
  });

  it("is an inserted Stage's own Stage change's Stage", () => {
    const edited = { ...LINUX, name: "Linux check" };
    const row: BuiltStage = {
      stage: LINUX,
      origin: "inserted",
      stageChangeIndexes: [0],
      baseStage: null,
      changedFields: [],
    };
    expect(stageDrafted([{ ...INSERT_LINUX, stage: edited }], row)).toEqual(edited);
  });
});
