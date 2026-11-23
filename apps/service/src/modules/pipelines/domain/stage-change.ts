/**
 * The Stage changes of a Project Pipeline as The Office kept them before Project Pipelines became
 * full Pipelines (spec §2.3.5, "The move to routes back and Publish Stages"). This file serves only
 * `movedProjectPipeline`, which builds a legacy row's flow once; nothing else reads Stage changes.
 */
import type { DutyKey } from "../../people/index.js";
import { asFlow, comparePlaces, pipelineOrder, straightLineFlow, type FlowStage } from "./flow.js";
import { stageProblems, type StageProblemAt } from "./pipeline.js";
import {
  isConditionGroup,
  plainRoute,
  testsOf,
  type ConditionGroup,
  type ConditionTest,
  type Route,
} from "./route.js";
import type { StageContextLimitsOverride } from "./stage-context-limits.js";
import type { StagePermissions } from "./stage-permissions.js";
import {
  sameAsKept,
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
  /** Gives the Stage this Role, and clears its duty. */
  readonly role?: string;
  /** Gives the Stage this duty, and clears its Role; a Change giving both is Broken. */
  readonly duty?: DutyKey;
  readonly brief?: string;
  readonly session?: StageSession;
  readonly budget?: number;
  readonly effort?: Effort | null;
  readonly permissions?: StagePermissions | null;
  readonly contextLimits?: StageContextLimitsOverride | null;
  readonly onFailure?: OnFailure | null;
  readonly command?: ScriptStageCommand;
  readonly publishTarget?: PublishTarget | null;
  readonly afterConflict?: AfterConflict | null;
}

export type StageField = keyof StageFieldChanges;

/** Each field as the UI names it. */
const STAGE_FIELD_NAMES: Readonly<Record<StageField, string>> = {
  name: "Name",
  optional: "Optional",
  role: "Role",
  duty: "Duty",
  brief: "Brief",
  session: "Session",
  budget: "Budget",
  effort: "Effort",
  permissions: "Permissions",
  contextLimits: "Context limits",
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
    "duty",
    "brief",
    "session",
    "budget",
    "effort",
    "permissions",
    "contextLimits",
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
  | { readonly kind: "remove"; readonly stageKey: string }
  | {
      readonly kind: "change-routes";
      readonly stageKey: string;
      /** The Stage's whole list of routes out, in the order the walk weighs them. */
      readonly routes: Route[];
    };

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
  /** Where on that Stage a broken rule is; absent for a Stage change that doesn't apply. */
  readonly at?: StageProblemAt;
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

/** A row as a build works on it: its Stage with its routes and its place. */
interface FlowRow extends BuiltStage {
  readonly stage: FlowStage;
}

/**
 * Builds the Stages (spec §2.3, "A Broken Project Pipeline"): the base Pipeline's Stages and routes,
 * then each Stage change in order, the rows and Stages coming out in the Pipeline's order. One that
 * doesn't apply is skipped with why, so every reason shows at once and the built Stages still read.
 * Broken means the built Stages can't run: a Stage change naming a key that isn't there, an inserted
 * key already there, a field its Stage's kind lacks, routes naming a Stage that is gone, or a rule
 * of the library's Pipelines (`stageProblems`) the built Stages break; its warnings don't. Rules
 * needing a Project or another module (commands, engines, who fills a Role) are weighed where those
 * are known.
 */
export function buildStages(
  base: BaseStages,
  stageChanges: readonly EditedStageChange[],
): BuiltStages {
  const rows: FlowRow[] = asFlow(base.stages).map((stage) => ({
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
  const stages = pipelineOrder(liveStages(rows));
  for (const { stageKey, at, text } of stageProblems(stages)) {
    const stageIndex = stages.findIndex(({ key }) => key === stageKey);
    broken.push({
      stageChangeIndex: undefined,
      stageIndex: stageIndex === -1 ? undefined : stageIndex,
      stageKey,
      ...(at ? { at } : {}),
      text,
    });
  }
  const ordered = rows.toSorted((one, other) => comparePlaces(one.stage.place, other.stage.place));
  return { rows: ordered, stages, stageChanges: named, broken };
}

/**
 * Applies the Stage change to `rows` at `row`, its Stage's row (undefined when it isn't there);
 * answers why it doesn't apply, or doesn't wholly, and leaves `rows` as they were then.
 */
function applied(
  rows: FlowRow[],
  row: FlowRow | undefined,
  stageChange: EditedStageChange,
  index: number,
  stageName: string,
  baseName: string,
): string | undefined {
  const words = stageChangeWords(stageChange, stageName);
  if (!row) {
    const removed = rows.some(
      ({ origin, stage }) => origin === "removed" && stage.key === stageChange.stageKey,
    );
    if (removed) return `${words}, which an earlier Stage change removes.`;
    return stageChange.stageName === undefined
      ? `${words}, which isn't among the Stages.`
      : `${words}, which ${baseName} no longer has.`;
  }
  switch (stageChange.kind) {
    case "insert-before":
    case "insert-after": {
      const taken = keyTakenWords(rows, -1, stageChange.stage.key, baseName);
      if (taken) return `${words}, but ${taken}`;
      const insert = stageChange.kind === "insert-before" ? insertBefore : insertAfter;
      insert(rows, row, stageChange.stage, index);
      return undefined;
    }
    case "replace": {
      const at = rows.indexOf(row);
      const taken = keyTakenWords(rows, at, stageChange.stage.key, baseName);
      if (taken) return `${words}, but ${taken}`;
      rows[at] = {
        ...row,
        stage: {
          ...withoutFlow(stageChange.stage),
          routes: row.stage.routes,
          place: row.stage.place,
        },
        origin: row.origin === "inserted" ? "inserted" : "replaced",
        stageChangeIndexes: [...row.stageChangeIndexes, index],
        changedFields: [],
      };
      if (stageChange.stage.key !== row.stage.key) {
        rekeyed(rows, row.stage.key, stageChange.stage.key);
      }
      return undefined;
    }
    case "change":
      return changeFields(rows, row, stageChange.fields, index, words, stageName);
    case "remove":
      removeStage(rows, row, index);
      return undefined;
    case "change-routes": {
      const gone = goneStageWords(rows, stageChange.routes);
      if (gone) return `${words}, which ${gone}, a Stage it no longer has.`;
      rows[rows.indexOf(row)] = {
        ...row,
        stage: { ...row.stage, routes: stageChange.routes },
        origin: row.origin === "base" ? "changed" : row.origin,
        stageChangeIndexes: [...row.stageChangeIndexes, index],
      };
      return undefined;
    }
  }
}

/**
 * Insert before: the new Stage takes its Stage's column on its row, that column and every later one
 * moving right by one; the routes that led into its Stage lead into it, and its one route, with no
 * condition, leads to its Stage.
 */
function insertBefore(rows: FlowRow[], row: FlowRow, stage: Stage, index: number): void {
  const at = rows.indexOf(row);
  const { key, place } = row.stage;
  movedColumns(rows, place.column, 1);
  routesMapped(rows, (route) => [route.to === key ? redirected(route, stage.key) : route]);
  rows.splice(at, 0, insertedRow(stage, [plainRoute(key)], place, index));
}

/**
 * Insert after: the new Stage takes the column after its Stage's, on its row, every later column
 * moving right by one; it takes over its Stage's routes out, whose tests of the previous Stage now
 * name that Stage, and its Stage gets one route with no condition to it.
 */
function insertAfter(rows: FlowRow[], row: FlowRow, stage: Stage, index: number): void {
  const at = rows.indexOf(row);
  const { key, place, routes } = row.stage;
  movedColumns(rows, place.column + 1, 1);
  const handed = routes.map((route) => withStageTests(route, (tested) => tested ?? key));
  rows[at] = { ...row, stage: { ...row.stage, routes: [plainRoute(stage.key)] } };
  const newPlace = { column: place.column + 1, row: place.row };
  rows.splice(at + 1, 0, insertedRow(stage, handed, newPlace, index));
}

function insertedRow(
  stage: Stage,
  routes: readonly Route[],
  place: FlowStage["place"],
  index: number,
): FlowRow {
  return {
    stage: { ...withoutFlow(stage), routes: [...routes], place },
    origin: "inserted",
    stageChangeIndexes: [index],
    baseStage: undefined,
    changedFields: [],
  };
}

/**
 * A Change gives the fields; the routes and the place stay. A Change giving `optional` to Stages
 * that are still the conversion's straight line is read as the conversion writes it: their routes
 * are drawn again from the new setting.
 */
function changeFields(
  rows: FlowRow[],
  row: FlowRow,
  fields: StageFieldChanges,
  index: number,
  words: string,
  stageName: string,
): string | undefined {
  if (namesRoleAndDuty(fields)) {
    return `${words}, giving it both a Role and a duty; name one of them.`;
  }
  const converted = fields.optional !== undefined && isConvertedLine(rows);
  const { stage, given, lacked } = withFields(row.stage, fields);
  rows[rows.indexOf(row)] = {
    ...row,
    stage: { ...stage, routes: row.stage.routes, place: row.stage.place },
    origin: row.origin === "base" && given.length > 0 ? "changed" : row.origin,
    stageChangeIndexes: [...row.stageChangeIndexes, index],
    changedFields: [...new Set([...row.changedFields, ...given])],
  };
  if (converted) redrawnAsLine(rows);
  if (lacked.length === 0) return undefined;
  const fieldNames = lacked.map((field) => STAGE_FIELD_NAMES[field]).join(", ");
  return `Changes ${fieldNames} of ${stageName}, which is now ${kindWords(row.stage.kind)}.`;
}

/** Whether the built Stages are exactly the conversion's straight line of themselves. */
function isConvertedLine(rows: readonly FlowRow[]): boolean {
  const ordered = pipelineOrder(liveStages(rows));
  return sameAsKept(ordered, straightLineFlow(ordered));
}

/** Draws the built Stages' routes and places again as the conversion does. */
function redrawnAsLine(rows: FlowRow[]): void {
  const line = new Map(
    straightLineFlow(pipelineOrder(liveStages(rows))).map((stage) => [stage.key, stage]),
  );
  rows.forEach((row, at) => {
    const stage = row.origin === "removed" ? undefined : line.get(row.stage.key);
    if (stage) rows[at] = { ...row, stage };
  });
}

/**
 * Remove: the Stage and its routes out are taken away, and each route into it leads where its one
 * route out led, keeping its own condition; when it had several, those routes in are taken away
 * too. A route the next one then makes needless is dropped, as a converted optional Stage's
 * Stage before it leaves one to the same place. A column it leaves empty is closed, the later
 * columns moving left by one.
 */
function removeStage(rows: FlowRow[], row: FlowRow, index: number): void {
  const at = rows.indexOf(row);
  const { key, routes, place } = row.stage;
  const [only, ...more] = routes;
  rows.forEach((other, otherAt) => {
    if (other.origin === "removed" || !other.stage.routes.some(({ to }) => to === key)) return;
    const led = other.stage.routes.flatMap((route) => {
      if (route.to !== key) return [route];
      return only && more.length === 0 ? [redirected(route, only.to)] : [];
    });
    rows[otherAt] = { ...other, stage: { ...other.stage, routes: withoutNeedlessRoutes(led) } };
  });
  rows[at] = {
    ...row,
    origin: "removed",
    stageChangeIndexes: [...row.stageChangeIndexes, index],
  };
  if (!liveStages(rows).some((stage) => stage.place.column === place.column)) {
    movedColumns(rows, place.column + 1, -1);
  }
}

/** A Replace giving a new key: the routes into the old key, and the tests naming it, name the new. */
function rekeyed(rows: FlowRow[], oldKey: string, newKey: string): void {
  routesMapped(rows, (route) => {
    const kept = route.to === oldKey ? redirected(route, newKey) : route;
    return [withStageTests(kept, (tested) => (tested === oldKey ? newKey : tested))];
  });
}

/** The words for the first Stage `routes` lead to or test that isn't among the built Stages. */
function goneStageWords(rows: readonly FlowRow[], routes: readonly Route[]): string | undefined {
  const keys = new Set(liveStages(rows).map(({ key }) => key));
  const [ledTo] = routes.flatMap(({ to, toName }) =>
    to !== null && !keys.has(to) ? [toName ?? to] : [],
  );
  if (ledTo !== undefined) return `lead to ${ledTo}`;
  const [tested] = routes
    .flatMap(({ condition }) => (condition ? testsOf(condition) : []))
    .flatMap(({ test }) =>
      test.kind === "stage" && test.stage !== null && !keys.has(test.stage)
        ? [test.stageName ?? test.stage]
        : [],
    );
  return tested === undefined ? undefined : `test ${tested}`;
}

/** Moves every row from `fromColumn` on by `by` columns: right when positive, left when negative. */
function movedColumns(rows: FlowRow[], fromColumn: number, by: number): void {
  rows.forEach((row, at) => {
    const { place } = row.stage;
    if (place.column < fromColumn) return;
    rows[at] = { ...row, stage: { ...row.stage, place: { ...place, column: place.column + by } } };
  });
}

/** Gives every built Stage the routes `map` makes of each of its routes. */
function routesMapped(rows: FlowRow[], map: (route: Route) => readonly Route[]): void {
  rows.forEach((row, at) => {
    if (row.origin === "removed") return;
    rows[at] = { ...row, stage: { ...row.stage, routes: row.stage.routes.flatMap(map) } };
  });
}

/**
 * `routes` less each one the route after it makes needless: one with no condition to the same
 * place, which the walk follows whenever the earlier one holds or not.
 */
function withoutNeedlessRoutes(routes: readonly Route[]): Route[] {
  return routes.reduceRight<Route[]>((later, route) => {
    const [next] = later;
    return next?.condition === null && next.to === route.to ? later : [route, ...later];
  }, []);
}

/** The route, keeping its condition, led to `to`. */
function redirected(route: Route, to: string | null): Route {
  return { to, condition: route.condition };
}

/** The route with each Stage test naming the Stage `retarget` gives for the one it named. */
function withStageTests(route: Route, retarget: (tested: string | null) => string | null): Route {
  if (!route.condition) return route;
  return { ...route, condition: groupWithStageTests(route.condition, retarget) };
}

function groupWithStageTests(
  group: ConditionGroup,
  retarget: (tested: string | null) => string | null,
): ConditionGroup {
  return {
    ...group,
    tests: group.tests.map((test): ConditionTest | ConditionGroup => {
      if (isConditionGroup(test)) return groupWithStageTests(test, retarget);
      if (test.kind !== "stage") return test;
      const stage = retarget(test.stage);
      return stage === test.stage ? test : { ...test, stage };
    }),
  };
}

function liveStages(rows: readonly FlowRow[]): FlowStage[] {
  return rows.filter(({ origin }) => origin !== "removed").map(({ stage }) => stage);
}

/** A Stage change's Stage as a build reads it: never with routes or a place of its own. */
function withoutFlow(stage: Stage): Stage {
  const { routes: _routes, place: _place, ...rest } = stage;
  return rest;
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
    else {
      changed[field] = value;
      const named = WORKER_FIELD_CLEARED[field];
      if (named !== undefined) delete changed[named];
    }
    given.push(field);
  }
  // Only fields of the Stage's own kind were set, each to a value of its type, so it is that kind.
  return { stage: changed as unknown as Stage, given, lacked };
}

/** A Stage names a Role or a duty, never both: giving one clears the other (spec §2.3). */
const WORKER_FIELD_CLEARED: Partial<Record<StageField, StageField>> = {
  role: "duty",
  duty: "role",
};

function namesRoleAndDuty(fields: StageFieldChanges): boolean {
  return fields.role !== undefined && fields.duty !== undefined;
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
    case "change-routes":
      return `Changes ${stageName}'s routes`;
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
