import { stageProblems } from "./pipeline.js";
import type { StagePermissions } from "./stage-permissions.js";
import {
  STAGE_KIND_NAMES,
  type AfterConflict,
  type Effort,
  type OnFailure,
  type PublishTarget,
  type ScriptStageCommand,
  type Stage,
  type StageKind,
  type StageSession,
} from "./stage.js";

/**
 * The fields a Change gives a Stage, each left out where the Stage keeps its own; `null` clears an
 * optional one. Never its key or kind: changing those takes a Replace (spec §2.3).
 */
export interface StageFieldChanges {
  readonly name?: string;
  readonly optional?: boolean;
  readonly role?: string;
  readonly brief?: string;
  readonly session?: StageSession;
  readonly budget?: number;
  readonly effort?: Effort | null;
  readonly permissions?: StagePermissions | null;
  readonly onFailure?: OnFailure | null;
  readonly command?: ScriptStageCommand;
  readonly publishTarget?: PublishTarget | null;
  readonly afterConflict?: AfterConflict | null;
}

export type StageField = keyof StageFieldChanges;

/** Each field as the UI names it. */
export const STAGE_FIELD_NAMES: Readonly<Record<StageField, string>> = {
  name: "Name",
  optional: "Optional",
  role: "Role",
  brief: "Brief",
  session: "Session",
  budget: "Budget",
  effort: "Effort",
  permissions: "Permissions",
  onFailure: "On failure",
  command: "Command",
  publishTarget: "Publish target",
  afterConflict: "After a conflict",
};

/** The fields each kind of Stage has, which a Change may give it. */
const FIELDS_OF_KIND: Readonly<Record<StageKind, readonly StageField[]>> = {
  agent: [
    "name",
    "optional",
    "role",
    "brief",
    "session",
    "budget",
    "effort",
    "permissions",
    "onFailure",
  ],
  script: ["name", "optional", "command", "publishTarget", "afterConflict", "onFailure"],
  gate: ["name", "optional"],
};

/**
 * One Stage change of a Project Pipeline (spec §2.3): it names its Stage by key, one of the base
 * Pipeline's Stages or one an earlier Stage change inserted.
 */
type StageChangeOfKind =
  | {
      readonly kind: "insert-before" | "insert-after" | "replace";
      readonly stageKey: string;
      /** The whole new Stage. */
      readonly stage: Stage;
    }
  | { readonly kind: "change"; readonly stageKey: string; readonly fields: StageFieldChanges }
  | { readonly kind: "remove"; readonly stageKey: string };

export type StageChangeKind = StageChangeOfKind["kind"];

/**
 * A Stage change as it is kept: with the name its Stage had when the Project Pipeline was last
 * saved, for its words alone, so a Stage gone from the base Pipeline still reads by its name.
 */
export type StageChange = StageChangeOfKind & { readonly stageName: string };

/**
 * A Stage change as an edit gives it: new, or as read with the name it kept, which a save
 * refreshes.
 */
export type EditedStageChange = StageChangeOfKind & { readonly stageName?: string };

/** Where a built Stage comes from, as the editor marks its row. */
export type StageOrigin = "base" | "inserted" | "replaced" | "changed" | "removed";

/** One row of the built Stages: a Stage with where it comes from. */
export interface BuiltStage {
  readonly stage: Stage;
  readonly origin: StageOrigin;
  /** The Stage changes that made it what it is, by their index, in order. */
  readonly stageChangeIndexes: readonly number[];
  /** The base Pipeline's Stage it stands for; undefined for an inserted one. */
  readonly baseStage: Stage | undefined;
  /** The fields Changes gave it, each once. */
  readonly changedFields: readonly StageField[];
}

/** Why a Project Pipeline is Broken, in the UI's words, with what it concerns. */
export interface BrokenReason {
  /** The Stage change that doesn't apply; undefined for a rule the built Stages break. */
  readonly stageChangeIndex: number | undefined;
  /** The built Stage the rule concerns, by its index among the built Stages. */
  readonly stageIndex: number | undefined;
  /** The key of the Stage it concerns. */
  readonly stageKey: string | undefined;
  readonly text: string;
}

/** The base Pipeline as a build reads it. */
export interface BaseStages {
  readonly name: string;
  readonly stages: readonly Stage[];
}

/** What building a Project Pipeline gives: its rows, its Stages, and why it is Broken, if it is. */
export interface BuiltStages {
  /** Every row in order, a removed Stage kept where it was. */
  readonly rows: readonly BuiltStage[];
  /** The Stages a Task on it would get: the rows but the removed ones. */
  readonly stages: readonly Stage[];
  /** The Stage changes, each with its Stage's name as it is now, or as kept when it is gone. */
  readonly stageChanges: readonly StageChange[];
  /** Empty when it isn't Broken. */
  readonly broken: readonly BrokenReason[];
}

/**
 * Builds the Stages (spec §2.3, "A Broken Project Pipeline"): the base Pipeline's Stages, then each
 * Stage change in order. One that doesn't apply is skipped with why, so every reason shows at once
 * and the built Stages still read. Broken means the built Stages can't run: a Stage change naming a
 * key that isn't there, an inserted key already there, a field its Stage's kind lacks, or a rule of
 * the library's Pipelines (`stageProblems`) the built Stages break. Rules needing a Project or
 * another module (commands, engines, who fills a Role) are weighed where those are known.
 */
export function buildStages(
  base: BaseStages,
  stageChanges: readonly EditedStageChange[],
): BuiltStages {
  const rows: BuiltStage[] = base.stages.map((stage) => ({
    stage,
    origin: "base",
    stageChangeIndexes: [],
    baseStage: stage,
    changedFields: [],
  }));
  const broken: BrokenReason[] = [];
  const named: StageChange[] = [];
  stageChanges.forEach((stageChange, index) => {
    const row = rows.find(
      ({ origin, stage }) => origin !== "removed" && stage.key === stageChange.stageKey,
    );
    const stageName = row ? nameOf(row.stage) : (stageChange.stageName ?? stageChange.stageKey);
    named.push({ ...stageChange, stageName });
    const reason = applied(rows, row, stageChange, index, stageName, base.name);
    if (reason !== undefined) {
      broken.push({
        stageChangeIndex: index,
        stageIndex: undefined,
        stageKey: stageChange.stageKey,
        text: reason,
      });
    }
  });
  const stages = rows.filter(({ origin }) => origin !== "removed").map(({ stage }) => stage);
  for (const { stageIndex, text } of stageProblems(stages)) {
    broken.push({
      stageChangeIndex: undefined,
      stageIndex,
      stageKey: stageIndex === undefined ? undefined : stages[stageIndex]?.key,
      text,
    });
  }
  return { rows, stages, stageChanges: named, broken };
}

/**
 * Applies the Stage change to `rows` at `row`, its Stage's row (undefined when it isn't there);
 * answers why it doesn't apply, or doesn't wholly, and leaves `rows` as they were then.
 */
function applied(
  rows: BuiltStage[],
  row: BuiltStage | undefined,
  stageChange: EditedStageChange,
  index: number,
  stageName: string,
  baseName: string,
): string | undefined {
  const words = stageChangeWords(stageChange, stageName);
  if (!row) {
    return stageChange.stageName === undefined
      ? `${words}, which isn't among the Stages.`
      : `${words}, which ${baseName} no longer has.`;
  }
  const at = rows.indexOf(row);
  switch (stageChange.kind) {
    case "insert-before":
    case "insert-after": {
      const taken = keyTakenWords(rows, -1, stageChange.stage.key, baseName);
      if (taken) return `${words}, but ${taken}`;
      rows.splice(stageChange.kind === "insert-before" ? at : at + 1, 0, {
        stage: stageChange.stage,
        origin: "inserted",
        stageChangeIndexes: [index],
        baseStage: undefined,
        changedFields: [],
      });
      return undefined;
    }
    case "replace": {
      const taken = keyTakenWords(rows, at, stageChange.stage.key, baseName);
      if (taken) return `${words}, but ${taken}`;
      rows[at] = {
        ...row,
        stage: stageChange.stage,
        origin: row.origin === "inserted" ? "inserted" : "replaced",
        stageChangeIndexes: [...row.stageChangeIndexes, index],
        changedFields: [],
      };
      return undefined;
    }
    case "change": {
      const { stage, given, lacked } = withFields(row.stage, stageChange.fields);
      rows[at] = {
        ...row,
        stage,
        origin: row.origin === "base" && given.length > 0 ? "changed" : row.origin,
        stageChangeIndexes: [...row.stageChangeIndexes, index],
        changedFields: [...new Set([...row.changedFields, ...given])],
      };
      if (lacked.length === 0) return undefined;
      const fields = lacked.map((field) => STAGE_FIELD_NAMES[field]).join(", ");
      return `Changes ${fields} of ${stageName}, which is now ${kindWords(row.stage.kind)}.`;
    }
    case "remove":
      rows[at] = {
        ...row,
        origin: "removed",
        stageChangeIndexes: [...row.stageChangeIndexes, index],
      };
      return undefined;
  }
}

/**
 * The Stage with the fields a Change gives it that its kind has (`given`); those its kind lacks
 * (`lacked`) are skipped.
 */
function withFields(
  stage: Stage,
  fields: StageFieldChanges,
): { readonly stage: Stage; readonly given: StageField[]; readonly lacked: StageField[] } {
  const kindFields = FIELDS_OF_KIND[stage.kind];
  const changed: Record<string, unknown> = { ...stage };
  const given: StageField[] = [];
  const lacked: StageField[] = [];
  for (const field of Object.keys(fields) as StageField[]) {
    const value = fields[field];
    if (value === undefined) continue;
    if (!kindFields.includes(field)) {
      lacked.push(field);
      continue;
    }
    if (value === null) delete changed[field];
    else changed[field] = value;
    given.push(field);
  }
  // Only fields of the Stage's own kind were set, each to a value of its type, so it is that kind.
  return { stage: changed as unknown as Stage, given, lacked };
}

/** The Stage changes that give their Stage no field at all: an emptied Change is dropped. */
export function emptyChangeIndexes(stageChanges: readonly EditedStageChange[]): number[] {
  return stageChanges.flatMap((stageChange, index) =>
    stageChange.kind === "change" &&
    Object.values(stageChange.fields).every((value) => value === undefined)
      ? [index]
      : [],
  );
}

/** "Inserts Verify on Linux after Review & fix", "Changes Produce", in the editor's words. */
export function stageChangeWords(stageChange: EditedStageChange, stageName: string): string {
  switch (stageChange.kind) {
    case "insert-before":
      return `Inserts ${nameOf(stageChange.stage)} before ${stageName}`;
    case "insert-after":
      return `Inserts ${nameOf(stageChange.stage)} after ${stageName}`;
    case "replace":
      return `Replaces ${stageName} with ${nameOf(stageChange.stage)}`;
    case "change":
      return `Changes ${stageName}`;
    case "remove":
      return `Removes ${stageName}`;
  }
}

/** Why the key is taken among the rows but the one at `except`; undefined when it is free. */
function keyTakenWords(
  rows: readonly BuiltStage[],
  except: number,
  key: string,
  baseName: string,
): string | undefined {
  const holder = rows.find(
    (row, index) => index !== except && row.origin !== "removed" && row.stage.key === key,
  );
  if (!holder) return undefined;
  return holder.baseStage?.key === key
    ? `${baseName} now has a Stage of its own with the same key.`
    : `another Stage has the key "${key}" already.`;
}

function kindWords(kind: StageKind): string {
  return `${kind === "agent" ? "an" : "a"} ${STAGE_KIND_NAMES[kind]}`;
}

function nameOf(stage: Stage): string {
  return stage.name.trim() || stage.key;
}
