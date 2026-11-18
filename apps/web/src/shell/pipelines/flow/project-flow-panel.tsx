import type { Stage } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu, Select, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  insertPlaces,
  isStageField,
  withFieldSetBack,
  withInsertPlaced,
  withoutRoutesChanged,
  withoutStageChangeOf,
  withStageRemoved,
  withStageReplaced,
  type InsertPlace,
  type StageChangeRow,
  type StageChangesShown,
} from "../stage-change-edits.ts";
import {
  fieldWords,
  routesUndoWords,
  STAGE_FIELD_LABELS,
  undoWords,
  type FieldWordsContext,
} from "../stage-change-words.ts";
import { namedCommands } from "../stage-commands.ts";
import { STAGE_KIND_ICONS, STAGE_KIND_NAMES, type StageKind } from "../stage-edits.ts";
import { StageForm } from "../stage-form.tsx";
import { routeTargetName, routeWhen } from "./condition-words.ts";
import { inFlowOrder, stageNamed } from "./flow-model.ts";
import { FlowOnFailure } from "./flow-on-failure.tsx";
import { FlowPanelEmpty, type FlowPanelProps } from "./flow-panel.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";
import { FlowRoutePanel } from "./flow-route-panel.tsx";
import { FlowRoutesOut } from "./flow-routes-out.tsx";
import { stageProblemsOf } from "./flow-view.ts";
import type { ProjectFlowEditorProps } from "./project-flow-editor.tsx";

const KINDS: readonly StageKind[] = ["agent", "script", "gate"];

type ProjectFlowPanelProps = ProjectFlowEditorProps &
  FlowPanelProps & {
    readonly shown: StageChangesShown;
  };

interface RowPanelProps extends ProjectFlowPanelProps {
  readonly row: StageChangeRow;
  /** Every row's Stage, a removed one too, for the names a route or a loop gives. */
  readonly named: readonly Stage[];
}

/**
 * Under a Project Pipeline's flow, its picked Stage or route: a Stage's fields as a Change, its
 * Routes out and On failure, with its Undo and its ⋯ menu (Replace, Remove from the-office's
 * Stages); a route's Goes to and condition, as a Change routes. A Change routes shows the base
 * Pipeline's routes beside the Project's with its Undo; a removed Stage shows its Undo alone.
 */
export function ProjectFlowPanel(props: ProjectFlowPanelProps): ReactNode {
  const { picked, shown, stages } = props;
  if (!picked) return <FlowPanelEmpty />;
  const rows = shown.rows.filter(({ built }) => built.stage.key === picked.key);
  const row = rows.find(({ built }) => built.origin !== "removed") ?? rows[0];
  if (!row) return <FlowPanelEmpty />;
  const named = [...stages, ...shown.rows.map(({ built }) => built.stage)];
  if (row.built.origin === "removed") return <RemovedPanel {...props} row={row} named={named} />;
  const stage = stageNamed(stages, picked.key);
  if (!stage) return <FlowPanelEmpty />;
  if (picked.kind === "route") {
    if (!stage.routes?.[picked.routeIndex]) return <FlowPanelEmpty />;
    return (
      <FlowRoutePanel
        {...props}
        stage={stage}
        routeIndex={picked.routeIndex}
        insertsOnRoute={false}
        after={<RoutesCompare {...props} row={row} named={named} stage={stage} />}
      />
    );
  }
  return (
    <ProjectStagePanel
      key={stage.key}
      {...props}
      row={row}
      named={named}
      stage={stage}
      onFailurePicked={picked.kind === "onFailure"}
    />
  );
}

function ProjectStagePanel(
  props: RowPanelProps & { readonly stage: Stage; readonly onFailurePicked: boolean },
): ReactNode {
  const { stage, stages, row, onEdited, problems, baseName } = props;
  const order = inFlowOrder(stages);
  const index = stages.indexOf(stage);
  const fromBase = row.built.origin === "base" || row.built.origin === "changed";
  return (
    <section className="flow-panel" aria-label={stage.name}>
      <div className="flow-panel-head">
        <PanelTitle stage={stage}>
          {STAGE_KIND_NAMES[stage.kind]} · {order.indexOf(stage) + 1} of {order.length} in the
          Pipeline's order
        </PanelTitle>
        <span className="flow-panel-tools">
          {row.stageChange && <UndoButton {...props} />}
          {fromBase && <StageChangeMenu {...props} />}
        </span>
      </div>
      <div className="flow-panel-body">
        <FlowProblemAlert problems={stageProblemsOf(problems, stage.key)} />
        {row.built.origin === "inserted" ? (
          <WhereItGoes {...props} />
        ) : (
          <p className="project-flow-note">
            <Icon name="info" size={13} />
            <span>
              {row.built.origin === "replaced"
                ? `Replaces ${baseName}'s ${row.built.baseStage?.name ?? stage.name}, under its key, so the loops that go back to it still do. Undo puts it back.`
                : `From ${baseName}: what you change here is a Change of only those fields, marked with ${baseName}'s value. The rest follows ${baseName}.`}
            </span>
          </p>
        )}
        <StageForm
          stages={stages}
          index={index}
          onChange={(changed) => onEdited({ stages: changed })}
          roles={props.roles}
          duties={props.duties}
          options={props.options}
          commands={props.commands}
          onFailureApart
        />
        {row.built.origin === "changed" && <FieldsCompare {...props} />}
        <FlowRoutesOut {...props} />
        <RoutesCompare {...props} />
        {stage.kind !== "gate" && <FlowOnFailure {...props} stage={stage} />}
      </div>
    </section>
  );
}

/** A removed Stage: kept in its place, struck through, with its Undo alone. */
function RemovedPanel(props: RowPanelProps): ReactNode {
  const { row, baseName, projectName } = props;
  const { stage } = row.built;
  return (
    <section className="flow-panel" aria-label={stage.name}>
      <div className="flow-panel-head">
        <PanelTitle stage={stage}>Removed</PanelTitle>
        <span className="flow-panel-tools">
          <UndoButton {...props} />
        </span>
      </div>
      <div className="flow-panel-body">
        <p className="project-flow-note">
          <Icon name="info" size={13} />
          <span>
            Removed: {projectName} doesn't get it. Each route that led into it leads where its one
            route out led. Undo puts {baseName}'s {stage.name} back, in its place.
          </span>
        </p>
      </div>
    </section>
  );
}

function PanelTitle({
  stage,
  children,
}: {
  readonly stage: Stage;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <h4 className="flow-panel-title">
      <span className={`flow-canvas-kind flow-canvas-kind--${stage.kind}`} aria-hidden="true">
        <Icon name={STAGE_KIND_ICONS[stage.kind]} size={11} />
      </span>
      {stage.name} <small>{children}</small>
    </h4>
  );
}

/** Undo of the Stage change that marks the row, as `undoWords` names it. */
function UndoButton({
  row,
  baseName,
  stageChanges,
  onChange,
  onPick,
  pending = false,
}: RowPanelProps): ReactNode {
  const words = undoWords(row, baseName);
  return (
    <Button
      size="sm"
      variant="ghost"
      title={words}
      aria-label={words}
      disabled={pending}
      iconLeft={<Icon name="undo-2" size={13} />}
      onClick={() => {
        onChange(withoutStageChangeOf(stageChanges, row.built));
        if (row.built.origin === "inserted") onPick(undefined);
      }}
    >
      Undo
    </Button>
  );
}

/** ⋯ on a Stage of the base Pipeline: Replace it with a new Stage of a kind, or Remove it. */
function StageChangeMenu({
  row,
  stage,
  built,
  stageChanges,
  onChange,
  projectName,
  pending = false,
}: RowPanelProps & { readonly stage: Stage }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={260}
      trigger={
        <IconButton
          size="sm"
          icon={<Icon name="ellipsis" size={14} />}
          label={`More for ${stage.name}`}
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={open}
        />
      }
      items={[
        { heading: `Replace ${stage.name} with` },
        ...KINDS.map((kind): MenuItem => ({
          label: `A new ${STAGE_KIND_NAMES[kind]}`,
          icon: <Icon name="arrow-left-right" size={14} />,
          onSelect: () => onChange(withStageReplaced(stageChanges, built.rows, row.built, kind)),
        })),
        { divider: true },
        {
          label: `Remove from ${projectName}'s Stages`,
          icon: <Icon name="trash-2" size={14} />,
          danger: true,
          onSelect: () => onChange(withStageRemoved(stageChanges, row.built)),
        },
      ]}
    />
  );
}

/** Where it goes: an inserted Stage keeps beside the Stage it names when the base Pipeline changes. */
function WhereItGoes({ row, built, stageChanges, baseName, onChange }: RowPanelProps): ReactNode {
  const places = insertPlaces(built.rows, stageChanges, row.built);
  const current =
    row.stageChange?.kind === "insert-before" || row.stageChange?.kind === "insert-after"
      ? `${row.stageChange.kind}:${row.stageChange.stageKey}`
      : "";
  return (
    <Select
      size="sm"
      label="Where it goes"
      hint={`Kept beside this Stage when ${baseName} changes.`}
      value={current}
      options={places.map((place) => ({
        value: placeValue(place),
        label: `${place.kind === "insert-before" ? "Before" : "After"} ${place.stage.name}`,
      }))}
      onChange={(value) => {
        const place = places.find((candidate) => placeValue(candidate) === value);
        if (place) onChange(withInsertPlaced(stageChanges, row.built, place));
      }}
    />
  );
}

/** A place as the Where it goes select's value: "insert-after:review". */
function placeValue(place: InsertPlace): string {
  return `${place.kind}:${place.stage.key}`;
}

/** A Change's fields: what the base Pipeline has, what the Project gets, and Set back on each. */
function FieldsCompare({
  row,
  stage,
  named,
  stageChanges,
  onChange,
  baseName,
  projectName,
  roles,
  duties,
  commands,
}: RowPanelProps & { readonly stage: Stage }): ReactNode {
  const { baseStage, changedFields } = row.built;
  const fields = changedFields.filter(isStageField);
  if (!baseStage || fields.length === 0) return null;
  const context: FieldWordsContext = {
    roles,
    duties,
    stages: named,
    commands: commands && namedCommands(commands),
  };
  return (
    <div className="project-flow-compare" role="table" aria-label={`What ${stage.name} changes`}>
      <div role="row" className="project-flow-compare-head">
        <span role="columnheader">Field</span>
        <span role="columnheader">{baseName} has</span>
        <span role="columnheader">{projectName} gets</span>
        <span role="columnheader" />
      </div>
      {fields.map((field) => {
        const label = STAGE_FIELD_LABELS[field];
        const setBack = `Set ${label} back to ${baseName}'s`;
        return (
          <div role="row" key={field}>
            <span role="rowheader" className="project-flow-compare-label">
              {label}
            </span>
            <span role="cell" className="project-flow-was" data-who={`${baseName} has`}>
              {fieldWords(baseStage, field, context)}
            </span>
            <span role="cell" className="project-flow-now" data-who={`${projectName} gets`}>
              {fieldWords(stage, field, context)}
            </span>
            <span role="cell" className="project-flow-set-back">
              <Button
                size="sm"
                variant="ghost"
                title={setBack}
                aria-label={setBack}
                iconLeft={<Icon name="undo-2" size={13} />}
                onClick={() => onChange(withFieldSetBack(stageChanges, row.built, field))}
              >
                Set back
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A Change routes: "Full has" beside "the-office gets", each route in the order it is weighed with
 * when it is followed, then "Undo: give Review & fix Full's routes back". An inserted Stage has no
 * base routes to show, only its Undo.
 */
function RoutesCompare({
  row,
  stage,
  named,
  stageChanges,
  onChange,
  baseName,
  projectName,
}: RowPanelProps & { readonly stage: Stage }): ReactNode {
  if (!row.routesChanged) return null;
  const base = row.built.origin === "inserted" ? null : row.built.baseStage;
  const lines = (from: Stage): ReactNode =>
    (from.routes ?? []).map((route, index) => (
      // A route has no key of its own: its place in the weighing order is it.
      <span key={index}>
        {index + 1}. → {routeTargetName(route, named)}, {routeWhen(route, from, named, index)}
      </span>
    ));
  const undo = routesUndoWords(stage.name, base ? baseName : undefined);
  return (
    <>
      {base && (
        <div
          className="project-flow-routes-compare"
          role="group"
          aria-label={`${stage.name}'s routes`}
        >
          <div>
            <b>{baseName} has</b>
            {lines(base)}
          </div>
          <div>
            <b>{projectName} gets</b>
            {lines(stage)}
          </div>
        </div>
      )}
      <div className="project-flow-undo">
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Icon name="undo-2" size={12} />}
          onClick={() => onChange(withoutRoutesChanged(stageChanges, stage.key))}
        >
          {undo}
        </Button>
      </div>
    </>
  );
}
