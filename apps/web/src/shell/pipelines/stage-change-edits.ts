import type {
  BrokenReason,
  BuiltStage,
  Route,
  Stage,
  StageChange,
  StageFieldChanges,
  StageProblem,
  StageTemplate,
} from "@the-office/contracts";
import { addStage, addStageFrom, keyAmong, type StageKind } from "./stage-edits.ts";

/**
 * A Project Pipeline's Stage changes (spec §2.3, "Project Pipelines") as the editor makes them, and
 * its built Stages as it shows them. The service builds the Stages (`ProjectPipelineCheck`'s rows);
 * these only read its rows against the draft's Stage changes and answer the next Stage changes,
 * each kept as small as it can be: a Change holds only the fields that differ from the base
 * Pipeline's Stage, and one left with none is dropped. Stage changes are found by the keys they
 * name, not by the rows' indexes, so an answer the service gave for the edit before still reads.
 */

/**
 * The fields a Change may give a Stage, in the Stage form's order. `optional` is left out: the walk
 * no longer reads it, so the editor neither offers nor shows it, though a Change may still carry
 * it for the release before.
 */
export type StageField = Exclude<keyof StageFieldChanges, "optional">;

export const STAGE_FIELDS: readonly StageField[] = [
  "name",
  "role",
  "duty",
  "command",
  "publishTarget",
  "afterConflict",
  "session",
  "budget",
  "effort",
  "brief",
  "permissions",
  "contextLimits",
  "onFailure",
];

/** Whether a field the service names is one the editor shows. */
export function isStageField(field: string): field is StageField {
  return (STAGE_FIELDS as readonly string[]).includes(field);
}

/** A Stage names a Role or a duty, never both: a Change giving one clears the other (spec §2.3). */
const WORKER_FIELD_CLEARED: Readonly<Record<string, StageField | undefined>> = {
  role: "duty",
  duty: "role",
};

/** The kinds of Stage change that bring a whole Stage of their own. */
type StageChangeWithStage = Extract<StageChange, { readonly stage: Stage }>;

/** One row of what the Project gets, as the editor marks it. */
export interface StageChangeRow {
  readonly built: BuiltStage;
  /** Its number among the Stages a Task gets, from 1; undefined for a removed one. */
  readonly number: number | undefined;
  /** The Stage change that marks it; undefined for a Stage of the base Pipeline as it is. */
  readonly stageChange: StageChange | undefined;
  /** Whether the draft has a Change routes Stage change of its Stage, found by its key. */
  readonly routesChanged: boolean;
  /** Why the built Stages are Broken on this row, such as a loop whose target is gone. */
  readonly broken: readonly BrokenReason[];
  /** What saving would be refused for, and what it is only warned about, on this row's Stage. */
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
}

/** How a Stage change that doesn't apply is fixed in place, beside "Remove this Stage change". */
export type NotApplyingFix =
  /** Its Stage is gone: "Apply it to" another Stage. */
  | "apply-to"
  /** The key it inserts is taken: "Give … a key of its own". */
  | "own-key";

export interface NotApplying {
  readonly index: number;
  readonly stageChange: StageChange;
  readonly why: string;
  readonly fix: NotApplyingFix;
}

/** What the editor shows of the service's answer: the rows, and the Stage changes on none. */
export interface StageChangesShown {
  readonly rows: readonly StageChangeRow[];
  readonly notApplying: readonly NotApplying[];
  /** Broken reasons on no row and no Stage change. */
  readonly brokenElsewhere: readonly BrokenReason[];
  /**
   * Problems and warnings on no row's Stage, Broken reasons left out as they show where they are:
   * the Pipeline's as a whole, and any on a Stage the draft no longer has.
   */
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
}

/** The service's built Stages, as its read and its check answer them. */
export interface BuiltRows {
  readonly rows: readonly BuiltStage[];
  readonly broken: readonly BrokenReason[];
}

/**
 * Each built row with its number, the Stage change that marks it and what is wrong on it; the
 * Stage changes that don't apply apart, as they have no row. `problems` and `warnings` name a Stage
 * by its key, as the service's check does.
 */
export function stageChangesShown(
  built: BuiltRows,
  stageChanges: readonly StageChange[],
  problems: readonly StageProblem[] = [],
  warnings: readonly StageProblem[] = [],
): StageChangesShown {
  const brokenTexts = new Set(built.broken.map(({ text }) => text));
  const onStage = (list: readonly StageProblem[], key: string): StageProblem[] =>
    list.filter(({ stageKey, text }) => stageKey === key && !brokenTexts.has(text));
  const rowKeys = new Set(
    built.rows.flatMap(({ origin, stage }) => (origin === "removed" ? [] : [stage.key])),
  );
  const onNoRow = ({ stageKey }: StageProblem): boolean =>
    stageKey === null || !rowKeys.has(stageKey);
  let number = 0;
  const rows = built.rows.map((row): StageChangeRow => {
    if (row.origin === "removed") {
      return {
        built: row,
        number: undefined,
        stageChange: stageChangeOf(stageChanges, row),
        routesChanged: false,
        broken: [],
        problems: [],
        warnings: [],
      };
    }
    const stageIndex = number;
    number += 1;
    return {
      built: row,
      number,
      stageChange: stageChangeOf(stageChanges, row),
      routesChanged: routesChangeOf(stageChanges, row.stage.key) !== undefined,
      broken: built.broken.filter(
        (reason) => reason.stageChangeIndex === null && reason.stageIndex === stageIndex,
      ),
      problems: onStage(problems, row.stage.key),
      warnings: onStage(warnings, row.stage.key),
    };
  });
  const notApplying = built.broken.flatMap((reason): NotApplying[] => {
    const stageChange =
      reason.stageChangeIndex === null ? undefined : stageChanges[reason.stageChangeIndex];
    if (reason.stageChangeIndex === null || !stageChange) return [];
    return [
      {
        index: reason.stageChangeIndex,
        stageChange,
        why: reason.text,
        fix: fixOf(stageChange, built.rows),
      },
    ];
  });
  return {
    rows,
    notApplying,
    brokenElsewhere: built.broken.filter(
      (reason) =>
        reason.stageIndex === null &&
        (reason.stageChangeIndex === null || !stageChanges[reason.stageChangeIndex]),
    ),
    problems: problems.filter((problem) => onNoRow(problem) && !brokenTexts.has(problem.text)),
    warnings: warnings.filter(onNoRow),
  };
}

/** The Stage change that marks a row, found by the key it names. */
export function stageChangeOf(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
): StageChange | undefined {
  const [index] = markingIndexes(stageChanges, row);
  return index === undefined ? undefined : stageChanges[index];
}

/** The indexes of the Stage changes that make the row what it is, by its origin. */
function markingIndexes(stageChanges: readonly StageChange[], row: BuiltStage): number[] {
  const key = row.stage.key;
  const matches = (test: (stageChange: StageChange) => boolean): number[] =>
    stageChanges.flatMap((stageChange, index) => (test(stageChange) ? [index] : []));
  switch (row.origin) {
    case "base":
      return [];
    case "inserted":
      return matches((stageChange) => bringsStage(stageChange) && stageChange.stage.key === key);
    case "replaced":
      return matches(
        (stageChange) => stageChange.kind === "replace" && stageChange.stage.key === key,
      );
    case "changed":
      // A Change of its fields first, as the row's Stage form edits that one.
      return [
        ...changeIndexes(stageChanges, key),
        ...matches(
          (stageChange) => stageChange.kind === "change-routes" && stageChange.stageKey === key,
        ),
      ];
    case "removed":
      return matches(
        (stageChange) => stageChange.kind === "remove" && stageChange.stageKey === key,
      );
  }
}

function bringsStage(stageChange: StageChange): stageChange is StageChangeWithStage {
  return "stage" in stageChange;
}

function changeIndexes(stageChanges: readonly StageChange[], stageKey: string): number[] {
  return stageChanges.flatMap((stageChange, index) =>
    stageChange.kind === "change" && stageChange.stageKey === stageKey ? [index] : [],
  );
}

/** A Stage change whose Stage is there but whose own key is taken gets a key of its own. */
function fixOf(stageChange: StageChange, rows: readonly BuiltStage[]): NotApplyingFix {
  const named = rows.some(
    ({ origin, stage }) => origin !== "removed" && stage.key === stageChange.stageKey,
  );
  return bringsStage(stageChange) && named ? "own-key" : "apply-to";
}

/**
 * The Stage changes once the user edited a row's Stage in the Stage form. An inserted or replacing
 * Stage is the Stage change's own, so it changes there; a Stage of the base Pipeline gets a Change
 * of only the fields that differ from it, and none once they all match again.
 */
export function withStageEdited(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
  edited: Stage,
): StageChange[] {
  if (row.origin === "inserted" || row.origin === "replaced") {
    const [index] = markingIndexes(stageChanges, row);
    const stageChange = index === undefined ? undefined : stageChanges[index];
    if (index === undefined || !stageChange || !bringsStage(stageChange)) return [...stageChanges];
    return stageChanges.with(index, { ...stageChange, stage: edited });
  }
  if (!row.baseStage) return [...stageChanges];
  return withChange(stageChanges, row.baseStage, fieldsDiffering(row.baseStage, edited));
}

/**
 * The row's Stage as the Stage changes being edited give it, ahead of the check's answer, so an edit
 * made before the check answers the last one builds on it: a Stage change's own Stage, or the base
 * Pipeline's Stage with its Change's fields.
 */
export function stageDrafted(stageChanges: readonly StageChange[], row: BuiltStage): Stage {
  if (row.origin === "inserted" || row.origin === "replaced") {
    const stageChange = stageChangeOf(stageChanges, row);
    return stageChange && bringsStage(stageChange) ? stageChange.stage : row.stage;
  }
  if (!row.baseStage) return row.stage;
  const drafted: Record<string, unknown> = { ...row.baseStage };
  for (const index of changeIndexes(stageChanges, row.baseStage.key)) {
    const stageChange = stageChanges[index];
    if (stageChange?.kind !== "change") continue;
    for (const [field, value] of Object.entries(stageChange.fields)) {
      if (value === null) delete drafted[field];
      else if (value !== undefined) drafted[field] = value;
      const cleared = value === undefined ? undefined : WORKER_FIELD_CLEARED[field];
      if (cleared !== undefined) delete drafted[cleared];
    }
  }
  // A Change gives only fields of its Stage's kind (the service flags any other), so it stays that kind.
  return drafted as unknown as Stage;
}

/** Set back: the field follows the base Pipeline's Stage again, dropped from its Change. */
export function withFieldSetBack(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
  field: StageField,
): StageChange[] {
  if (!row.baseStage) return [...stageChanges];
  const given = changeIndexes(stageChanges, row.baseStage.key).flatMap((index) => {
    const stageChange = stageChanges[index];
    return stageChange?.kind === "change" ? [stageChange.fields] : [];
  });
  const { [field]: _setBack, ...rest } = Object.assign({}, ...given) as StageFieldChanges;
  return withChange(stageChanges, row.baseStage, rest);
}

/**
 * The base Stage's Changes become one with `fields`, where the first was; with no field, none. A
 * Change names its Stage by the base Pipeline's key, which no Change may give another.
 */
function withChange(
  stageChanges: readonly StageChange[],
  baseStage: Stage,
  fields: Partial<StageFieldChanges>,
): StageChange[] {
  const indexes = changeIndexes(stageChanges, baseStage.key);
  const kept = Object.keys(fields).length > 0;
  const change: StageChange = {
    kind: "change",
    stageKey: baseStage.key,
    stageName: baseStage.name,
    fields: fields as StageFieldChanges,
  };
  const [first] = indexes;
  if (first === undefined) return kept ? [...stageChanges, change] : [...stageChanges];
  return stageChanges.flatMap((stageChange, index) => {
    if (index === first) return kept ? [change] : [];
    return indexes.includes(index) ? [] : [stageChange];
  });
}

/**
 * The fields `edited` gives that differ from `base`; `null` clears one the base Stage has. The Role
 * and the duty are never cleared so: giving one clears the other.
 */
export function fieldsDiffering(base: Stage, edited: Stage): Partial<StageFieldChanges> {
  const was = base as Partial<Record<StageField, unknown>>;
  const now = edited as Partial<Record<StageField, unknown>>;
  const fields: Partial<Record<StageField, unknown>> = {};
  for (const field of STAGE_FIELDS) {
    if (sameValue(was[field], now[field])) continue;
    const value = now[field] ?? null;
    if (value === null && WORKER_FIELD_CLEARED[field] !== undefined) continue;
    fields[field] = value;
  }
  return fields as Partial<StageFieldChanges>;
}

/**
 * Undo of one Stage change: the row is as the base Pipeline has it again, or an inserted Stage is
 * taken out. What later Stage changes did to an inserted or replacing Stage, by its own key, goes
 * with it, as it would no longer apply.
 */
export function withoutStageChangeOf(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
): StageChange[] {
  return withoutIndexes(stageChanges, markingIndexes(stageChanges, row));
}

/** Remove this Stage change: one that doesn't apply, by its index. */
export function withoutStageChange(
  stageChanges: readonly StageChange[],
  index: number,
): StageChange[] {
  return withoutIndexes(stageChanges, [index]);
}

function withoutIndexes(
  stageChanges: readonly StageChange[],
  indexes: readonly number[],
): StageChange[] {
  const dropped = new Set(indexes);
  const ownKeys = new Set<string>();
  // Follows the chain: a Stage inserted beside a dropped Stage goes too, and so on.
  for (let grown = true; grown;) {
    grown = false;
    stageChanges.forEach((stageChange, index) => {
      if (!dropped.has(index) && ownKeys.has(stageChange.stageKey)) {
        dropped.add(index);
        grown = true;
      }
      if (
        dropped.has(index) &&
        bringsStage(stageChange) &&
        stageChange.stage.key !== stageChange.stageKey &&
        !ownKeys.has(stageChange.stage.key)
      ) {
        ownKeys.add(stageChange.stage.key);
        grown = true;
      }
    });
  }
  return stageChanges.filter((_stageChange, index) => !dropped.has(index));
}

/** What an insert point between two rows inserts beside: the Stage above it, or before the first. */
export interface InsertPlace {
  readonly kind: "insert-before" | "insert-after";
  readonly stage: Stage;
}

/** The insert point before row `at` (`rows.length` for the end); a removed row is passed over. */
export function insertPlace(rows: readonly BuiltStage[], at: number): InsertPlace | undefined {
  const above = rows.slice(0, at).findLast(({ origin }) => origin !== "removed");
  if (above) return { kind: "insert-after", stage: above.stage };
  const below = rows.slice(at).find(({ origin }) => origin !== "removed");
  return below && { kind: "insert-before", stage: below.stage };
}

/**
 * A new Stage of `kind`, or a copy of a template's, named and keyed apart from every row's and from
 * the Stages of Stage changes that don't apply, which have no row.
 */
export function newStageAmong(
  rows: readonly BuiltStage[],
  from: StageKind | StageTemplate,
  stageChanges: readonly StageChange[],
): Stage {
  const stages = [
    ...rows.map(({ stage }) => stage),
    ...stageChanges.filter(bringsStage).map(({ stage }) => stage),
  ];
  const added = typeof from === "string" ? addStage(stages, from) : addStageFrom(stages, from);
  const stage = added.stages[added.index];
  if (!stage) throw new Error("The added Stage isn't among the Stages.");
  return stage;
}

/** Insert before or after: the Stage inserted at the place, as the last Stage change. */
export function withStageInserted(
  stageChanges: readonly StageChange[],
  place: InsertPlace,
  stage: Stage,
): StageChange[] {
  return [
    ...stageChanges,
    { kind: place.kind, stageKey: place.stage.key, stageName: place.stage.name, stage },
  ];
}

/**
 * Replace: a new Stage of `kind` in place of a Stage of the base Pipeline, under its key, so the
 * loops that go back to it still do; a Change of it goes, as the new Stage is whole.
 */
export function withStageReplaced(
  stageChanges: readonly StageChange[],
  rows: readonly BuiltStage[],
  row: BuiltStage,
  kind: StageKind,
): StageChange[] {
  const baseStage = row.baseStage ?? row.stage;
  const stage = {
    ...newStageAmong(
      rows.filter((other) => other !== row),
      kind,
      stageChanges,
    ),
    key: baseStage.key,
  };
  return [
    ...withChange(stageChanges, baseStage, {}),
    { kind: "replace", stageKey: baseStage.key, stageName: baseStage.name, stage },
  ];
}

/** Remove: the Stage of the base Pipeline left out; a Change of it goes with it. */
export function withStageRemoved(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
): StageChange[] {
  const baseStage = row.baseStage ?? row.stage;
  return [
    ...withChange(stageChanges, baseStage, {}),
    { kind: "remove", stageKey: baseStage.key, stageName: baseStage.name },
  ];
}

/** Apply it to: a Stage change whose Stage is gone names another of the rows. */
export function withStageChangeAppliedTo(
  stageChanges: readonly StageChange[],
  index: number,
  stage: Stage,
): StageChange[] {
  const stageChange = stageChanges[index];
  if (!stageChange) return [...stageChanges];
  return stageChanges.with(index, { ...stageChange, stageKey: stage.key, stageName: stage.name });
}

/** Give … a key of its own: an inserted Stage whose key the base Pipeline took gets a new one. */
export function withOwnKey(
  stageChanges: readonly StageChange[],
  index: number,
  rows: readonly BuiltStage[],
): StageChange[] {
  const stageChange = stageChanges[index];
  if (!stageChange || !bringsStage(stageChange)) return [...stageChanges];
  const taken = [
    ...rows.map(({ stage }) => stage),
    ...stageChanges.filter(bringsStage).map(({ stage }) => stage),
  ];
  const key = keyAmong(stageChange.stage, taken);
  return stageChanges.with(index, { ...stageChange, stage: { ...stageChange.stage, key } });
}

/** Where it goes: an inserted Stage moved before or after another Stage. */
export function withInsertPlaced(
  stageChanges: readonly StageChange[],
  row: BuiltStage,
  place: InsertPlace,
): StageChange[] {
  const [index] = markingIndexes(stageChanges, row);
  const stageChange = index === undefined ? undefined : stageChanges[index];
  if (
    index === undefined ||
    (stageChange?.kind !== "insert-before" && stageChange?.kind !== "insert-after")
  ) {
    return [...stageChanges];
  }
  return stageChanges.with(index, {
    kind: place.kind,
    stageKey: place.stage.key,
    stageName: place.stage.name,
    stage: stageChange.stage,
  });
}

/**
 * The places an inserted Stage may go: before or after each Stage a Task gets but itself and the
 * Stages inserted after it, which it can't name as they come later in the Stage changes.
 */
export function insertPlaces(
  rows: readonly BuiltStage[],
  stageChanges: readonly StageChange[],
  row: BuiltStage,
): InsertPlace[] {
  const [own] = markingIndexes(stageChanges, row);
  const insertedLater = new Set(
    stageChanges.flatMap((stageChange, index) =>
      own !== undefined && index > own && bringsStage(stageChange) ? [stageChange.stage.key] : [],
    ),
  );
  return rows
    .filter(
      (other) => other.origin !== "removed" && other !== row && !insertedLater.has(other.stage.key),
    )
    .flatMap(({ stage }): InsertPlace[] => [
      { kind: "insert-before", stage },
      { kind: "insert-after", stage },
    ]);
}

/** The Change routes Stage change of the Stage with `key`, found by the key it names. */
export function routesChangeOf(
  stageChanges: readonly StageChange[],
  key: string,
): Extract<StageChange, { kind: "change-routes" }> | undefined {
  return stageChanges.find(
    (stageChange): stageChange is Extract<StageChange, { kind: "change-routes" }> =>
      stageChange.kind === "change-routes" && stageChange.stageKey === key,
  );
}

/**
 * The Stage changes once the user edited the routes out of the Stage with `key`, on the built rows:
 * one Change routes Stage change giving them whole, last, so it applies to the Stages as they are
 * shown, with every Stage change before it applied; none once they are the routes the Stage would
 * have without it again. Those are the row's routes while it has none yet, and the base Pipeline's
 * Stage's once it has one (an inserted Stage's are only dropped by Undo).
 */
export function withRoutesChanged(
  stageChanges: readonly StageChange[],
  rows: readonly BuiltStage[],
  key: string,
  routes: readonly Route[],
): StageChange[] {
  const row = rows.find(({ origin, stage }) => origin !== "removed" && stage.key === key);
  const without = withoutRoutesChanged(stageChanges, key);
  const had = without.length !== stageChanges.length;
  const routesWithout = !had
    ? row?.stage.routes
    : row?.origin === "inserted"
      ? undefined
      : row?.baseStage?.routes;
  if (routesWithout !== undefined && sameRoutes(routesWithout, routes)) return without;
  return [
    ...without,
    {
      kind: "change-routes",
      stageKey: key,
      stageName: row?.stage.name ?? key,
      routes: [...routes],
    },
  ];
}

/** Undo of a Change routes: the Stage's routes as its Stage changes but that one give them. */
export function withoutRoutesChanged(
  stageChanges: readonly StageChange[],
  key: string,
): StageChange[] {
  return stageChanges.filter(
    (stageChange) => !(stageChange.kind === "change-routes" && stageChange.stageKey === key),
  );
}

/** Two lists of routes alike, the names kept for their words alone left out. */
export function sameRoutes(one: readonly Route[], other: readonly Route[]): boolean {
  return JSON.stringify(one, unnamedKeys) === JSON.stringify(other, unnamedKeys);
}

function unnamedKeys(key: string, value: unknown): unknown {
  return key === "toName" || key === "stageName" ? undefined : sortedKeys(key, value);
}

/** The values of two fields alike whatever order their keys came in. */
function sameValue(one: unknown, other: unknown): boolean {
  return JSON.stringify(one, sortedKeys) === JSON.stringify(other, sortedKeys);
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
  );
}
