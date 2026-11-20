import type { BuiltStage, Stage, StageChange, StageProblem } from "@the-office/contracts";
import {
  fieldsDiffering,
  routesChangeOf,
  stageDrafted,
  withRoutesChanged,
  withStageEdited,
  type StageChangesShown,
} from "../stage-change-edits.ts";
import { originWords } from "../stage-change-words.ts";
import type { FlowStageMark, FlowStageMarks } from "./flow-marks.ts";

/**
 * A Project Pipeline's flow in the flow editor (docs/design/pipeline-flow.html, "A Project Pipeline
 * as a flow"): the built rows as the canvas draws them, each marked, and every edit of the panel or
 * the canvas, made on its Stages with flow-model as Settings makes them, read back as Stage
 * changes: a route's as a Change routes, a field's as a Change of only that field.
 */

/**
 * Every row's Stage, a removed one too, with its place and routes; ahead of the check's answer, as
 * the draft's Stage changes give it, so an edit made before the check answers builds on the last.
 * A removed Stage keeps its column, on the first row no other Stage takes: the service closes the
 * column it leaves empty, so the next column's Stages come to its place.
 */
export function projectFlowStages(
  rows: readonly BuiltStage[],
  stageChanges: readonly StageChange[],
): Stage[] {
  const stages = rows.map((row): Stage => {
    if (row.origin === "removed") return row.stage;
    const { routes: _routes, place: _place, ...drafted } = stageDrafted(stageChanges, row);
    return {
      ...drafted,
      key: row.stage.key,
      routes: routesChangeOf(stageChanges, row.stage.key)?.routes ?? row.stage.routes ?? [],
      ...(row.stage.place ? { place: row.stage.place } : {}),
    } as Stage;
  });
  const taken = new Set(
    stages.flatMap(({ place }, at) =>
      place && rows[at]?.origin !== "removed" ? [`${place.column}:${place.row}`] : [],
    ),
  );
  return stages.map((stage, at) => {
    if (rows[at]?.origin !== "removed" || !stage.place) return stage;
    const { column } = stage.place;
    let { row } = stage.place;
    while (taken.has(`${column}:${row}`)) row += 1;
    taken.add(`${column}:${row}`);
    return row === stage.place.row ? stage : { ...stage, place: { column, row } };
  });
}

/** Each marked row's mark on its left edge, by its Stage's key; a Stage as the base has it, none. */
export function projectFlowMarks(shown: StageChangesShown, baseName: string): FlowStageMarks {
  const marks = new Map<string, FlowStageMark>();
  for (const row of shown.rows) {
    const { tone, text } = originWords(row, baseName);
    const mark = markOf(row.built, tone, row.routesChanged);
    if (mark) marks.set(row.built.stage.key, { tone: mark, label: text });
  }
  return marks;
}

function markOf(
  row: BuiltStage,
  tone: ReturnType<typeof originWords>["tone"],
  routesChanged: boolean,
): FlowStageMark["tone"] | undefined {
  switch (row.origin) {
    case "inserted":
    case "replaced":
    case "removed":
      return row.origin;
    case "base":
    case "changed":
      if (tone === "plain") return undefined;
      return routesChanged && row.changedFields.length === 0 ? "routes-changed" : "changed";
  }
}

/**
 * The check's problems as the flow editor shows them, each on its Stage: the service's Broken
 * reasons on a row too, which no Stage change's block shows; a problem worded as one of them once.
 */
export function projectFlowProblems(
  shown: StageChangesShown,
  problems: readonly StageProblem[],
): StageProblem[] {
  const onRows = shown.rows.flatMap(({ built, broken }) =>
    broken.map(({ text }): StageProblem => ({
      stageKey: built.stage.key,
      at: null,
      level: "problem",
      text,
    })),
  );
  const texts = new Set(onRows.map(({ text }) => text));
  return [...problems.filter(({ text }) => !texts.has(text)), ...onRows];
}

/**
 * The Stage changes once an edit made `after` of the live Stages `before`: each Stage whose routes
 * differ gets its Change routes made or updated, and one whose own fields differ its Change (or its
 * Stage change's own Stage). A Stage not among the rows, as an edit adding one would make, is left
 * out: a Project Pipeline adds a Stage only by Insert.
 */
export function projectStagesEdited(
  stageChanges: readonly StageChange[],
  rows: readonly BuiltStage[],
  before: readonly Stage[],
  after: readonly Stage[],
): StageChange[] {
  let next = [...stageChanges];
  for (const stage of after) {
    const was = before.find(({ key }) => key === stage.key);
    const row = rows.find(
      ({ origin, stage: built }) => origin !== "removed" && built.key === stage.key,
    );
    if (!was || !row) continue;
    if (JSON.stringify(was.routes ?? []) !== JSON.stringify(stage.routes ?? [])) {
      next = withRoutesChanged(next, rows, stage.key, stage.routes ?? []);
    }
    if (Object.keys(fieldsDiffering(was, stage)).length > 0) {
      const { routes: _routes, place: _place, ...fields } = stage;
      next = withStageEdited(next, row, fields as Stage);
    }
  }
  return next;
}
