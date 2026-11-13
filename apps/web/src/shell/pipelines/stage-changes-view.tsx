import { useQuery } from "@tanstack/react-query";
import type {
  BuiltStage,
  Role,
  RoleCardOptions,
  Stage,
  StageChange,
  StageProblem,
} from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  Icon,
  IconButton,
  Menu,
  Select,
  type MenuItem,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { stageTemplateQueries } from "../../api/pipelines.ts";
import { stageDetailsLine, whoWorks } from "./pipeline-words.ts";
import { StageCheckAlerts } from "./stage-check-alerts.tsx";
import {
  insertPlace,
  insertPlaces,
  newStageAmong,
  stageChangesShown,
  stageDrafted,
  withFieldSetBack,
  withInsertPlaced,
  withOwnKey,
  withStageChangeAppliedTo,
  withStageEdited,
  withStageInserted,
  withStageRemoved,
  withStageReplaced,
  withoutStageChange,
  withoutStageChangeOf,
  type BuiltRows,
  type InsertPlace,
  type NotApplying,
  type StageChangeRow,
  type StageField,
} from "./stage-change-edits.ts";
import {
  changedFieldsWords,
  counted,
  fieldWords,
  getsLine,
  originWords,
  STAGE_CHANGE_KIND_NAMES,
  STAGE_FIELD_LABELS,
  undoWords,
  type FieldWordsContext,
} from "./stage-change-words.ts";
import { namedCommands, type StageCommandSource } from "./stage-commands.ts";
import {
  failureTargets,
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  type StageKind,
} from "./stage-edits.ts";
import { StageForm } from "./stage-form.tsx";
import "./stage-changes-view.css";

const KINDS: readonly StageKind[] = ["agent", "script", "gate"];

/** The "On failure" fix's value for "Ask you": the Stage gets no failure rule. */
const ASK_YOU = "";

export interface StageChangesViewProps {
  /** Whose Stages these are, as "What the-office gets" names them. */
  readonly projectName: string;
  readonly baseName: string;
  /** The Stages as the service built them from the base Pipeline and `stageChanges`. */
  readonly built: BuiltRows;
  readonly stageChanges: readonly StageChange[];
  /** Absent for a view that only shows, such as a Proposal's. */
  readonly onChange?: (stageChanges: readonly StageChange[]) => void;
  /** What saving would be refused for, and what is only flagged, from the service's check. */
  readonly problems?: readonly StageProblem[];
  readonly flags?: readonly StageProblem[];
  /** While the service's answer is for an earlier edit: the edits that name a row by place wait. */
  readonly pending?: boolean;
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  /** What a Script Stage may run: the Project's own commands. */
  readonly commands?: StageCommandSource;
}

/**
 * What a Project gets (docs/design/project-pipelines.html, "The editor"): its built Stages in one
 * list, each marked as from the base Pipeline, inserted, replaced, changed or removed, with the
 * Stage changes that don't apply above it. Every edit answers the next Stage changes, which the
 * service builds again.
 */
export function StageChangesView(props: StageChangesViewProps): ReactNode {
  const { projectName, baseName, built, stageChanges, onChange, problems = [], flags = [] } = props;
  const [open, setOpen] = useState<string | undefined>();
  const shown = stageChangesShown(built, stageChanges, problems, flags);
  const readOnly = onChange === undefined;
  const live = built.rows.filter(({ origin }) => origin !== "removed");
  const baseStages = built.rows.filter(({ origin }) => origin !== "inserted").length;
  const edit = (next: readonly StageChange[], opened?: string): void => {
    onChange?.(next);
    if (opened !== undefined) setOpen(opened);
  };
  const listName = `What ${projectName} gets`;
  return (
    <div className="stage-changes">
      <div className="stage-changes-head">
        <h3>{listName}</h3>
        <span className="stage-changes-sum">
          {getsLine(live.length, baseStages, baseName, stageChanges.length)}
        </span>
        <Legend baseName={baseName} />
      </div>
      <StageCheckAlerts
        problems={shown.problems}
        flags={shown.flags}
        problemsTitle="The Pipeline can't be saved yet"
      />
      {shown.brokenElsewhere.length > 0 && (
        <Alert tone="danger" title="These Stages can't run as they are">
          <ul className="refusal-reasons">
            {shown.brokenElsewhere.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
      {shown.notApplying.length > 0 && (
        <NotApplyingBlock
          {...props}
          notApplying={shown.notApplying}
          live={live}
          onFix={readOnly ? undefined : (next) => edit(next)}
        />
      )}
      <ol className="stage-changes-list" aria-label={listName}>
        {shown.rows.map((row, at) => (
          <StageChangesRowItem
            // By the Stage's key alone, so a Stage keeps its open form as its origin or place changes.
            key={`${row.built.origin === "removed" ? "removed-" : ""}${row.built.stage.key}`}
            {...props}
            row={row}
            at={at}
            open={open === row.built.stage.key && row.built.origin !== "removed"}
            onToggle={() => setOpen(open === row.built.stage.key ? undefined : row.built.stage.key)}
            onEdit={readOnly ? undefined : edit}
          />
        ))}
        {!readOnly && <InsertPoint {...props} at={built.rows.length} onEdit={edit} />}
      </ol>
      {!readOnly && (
        <p className="stage-changes-rules">
          <Icon name="info" size={13} />
          <span>
            Each mark is one Stage change. A Stage from {baseName} follows {baseName}'s edits;
            editing it here makes a Change of only the fields you edit. {baseName} itself stays as
            it is.
          </span>
        </p>
      )}
    </div>
  );
}

function Legend({ baseName }: { readonly baseName: string }): ReactNode {
  return (
    <span className="stage-changes-legend" aria-hidden="true">
      <span>
        <i className="plain" />
        From {baseName}
      </span>
      <span>
        <i className="inserted" />
        Inserted
      </span>
      <span>
        <i className="replaced" />
        Replaced
      </span>
      <span>
        <i className="changed" />
        Changed
      </span>
      <span>
        <i className="removed" />
        Removed
      </span>
    </span>
  );
}

interface RowProps extends StageChangesViewProps {
  readonly row: StageChangeRow;
  /** Its place among the rows, where an insert point before it inserts. */
  readonly at: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onEdit: ((next: readonly StageChange[], opened?: string) => void) | undefined;
}

function StageChangesRowItem(props: RowProps): ReactNode {
  const { row, at, open, onToggle, onEdit, built, baseName, roles, commands } = props;
  const [folded, setFolded] = useState(true);
  const { stage, origin } = row.built;
  const stages = built.rows
    .filter((other) => other.origin !== "removed")
    .map((other) => other.stage);
  const flagged = row.broken.length > 0;
  const foldable = (origin === "changed" || origin === "replaced") && !open;
  const classes = [
    "stage-changes-row",
    origin,
    flagged && "flagged",
    (open || row.problems.length > 0) && "open",
  ].filter(Boolean);
  const name = stage.name.trim() || STAGE_KIND_NAMES[stage.kind];
  const details = stageDetailsLine(stage, stages);
  return (
    <>
      {onEdit && <InsertPoint {...props} at={at} onEdit={onEdit} />}
      <li className={classes.join(" ")} aria-label={name}>
        <div className="stage-changes-line">
          <span className="stage-changes-number">{row.number}</span>
          <span className="stage-changes-kind" title={STAGE_KIND_NAMES[stage.kind]}>
            <Icon name={STAGE_KIND_ICONS[stage.kind]} size={13} />
          </span>
          <span className="stage-changes-words">
            <span className="stage-changes-name">
              {name}{" "}
              <span className="stage-changes-who">
                · {whoWorks(stage, roles, commands && namedCommands(commands))}
              </span>
            </span>
            {details !== "" && <span className="stage-changes-detail">{details}</span>}
          </span>
          <span className="stage-changes-origin">
            <OriginMark row={row} baseName={baseName} />
          </span>
          <span className="stage-changes-tools">
            {foldable && (
              <IconButton
                size="sm"
                icon={<Icon name={folded ? "chevron-down" : "chevron-up"} size={14} />}
                label={`${folded ? "Show" : "Hide"} what ${origin === "changed" ? "changed" : "it replaces"}`}
                onClick={() => setFolded(!folded)}
              />
            )}
            {onEdit && <RowTools {...props} name={name} onEdit={onEdit} onToggle={onToggle} />}
          </span>
        </div>
        {row.broken.map((reason) => (
          <div key={reason.text} className="stage-changes-problem" role="alert">
            <Icon name="circle-alert" size={14} />
            <span>{reason.text}</span>
            {onEdit && stage.kind !== "gate" && (
              <LoopFix {...props} stage={stage} stages={stages} onEdit={onEdit} />
            )}
          </div>
        ))}
        {[...row.problems, ...row.flags].map(({ text }) => (
          <div key={text} className="stage-changes-flag">
            <Icon name="triangle-alert" size={14} />
            <span>{text}</span>
          </div>
        ))}
        {open && onEdit && (
          <div className="stage-changes-more">
            <StageEditFields {...props} stages={stages} onEdit={onEdit} />
          </div>
        )}
        {!open && !folded && origin === "changed" && (
          <div className="stage-changes-more">
            <CompareTable {...props} stages={stages} onEdit={onEdit} />
          </div>
        )}
        {!open && !folded && origin === "replaced" && row.built.baseStage && (
          <div className="stage-changes-more">
            <ReplacedBy {...props} baseStage={row.built.baseStage} stages={stages} />
          </div>
        )}
      </li>
    </>
  );
}

function OriginMark({
  row,
  baseName,
}: {
  readonly row: StageChangeRow;
  readonly baseName: string;
}): ReactNode {
  const { tone, text } = originWords(row, baseName);
  if (tone === "plain") return <span>{text}</span>;
  return (
    <Badge size="sm" tone={tone}>
      {text}
    </Badge>
  );
}

/** Edit, Undo, and on a Stage of the base Pipeline its menu: Replace with and Remove. */
function RowTools({
  row,
  name,
  open,
  onToggle,
  onEdit,
  built,
  stageChanges,
  projectName,
  baseName,
  pending = false,
}: RowProps & {
  readonly name: string;
  readonly onEdit: (next: readonly StageChange[], opened?: string) => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const { origin } = row.built;
  const fromBase = origin === "base" || origin === "changed";
  const undo = undoWords(row, baseName);
  return (
    <>
      {origin !== "removed" && (
        <IconButton
          size="sm"
          icon={<Icon name={open ? "chevron-up" : "pencil"} size={14} />}
          label={open ? `Done editing ${name}` : `Edit ${name}`}
          onClick={onToggle}
        />
      )}
      {origin !== "base" && (
        <Button
          size="sm"
          variant="ghost"
          title={undo}
          aria-label={undo}
          disabled={pending}
          iconLeft={<Icon name="undo-2" size={13} />}
          onClick={() => onEdit(withoutStageChangeOf(stageChanges, row.built))}
        >
          <span className="stage-changes-undo-word">Undo</span>
        </Button>
      )}
      {fromBase && (
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          width={260}
          trigger={
            <IconButton
              size="sm"
              icon={<Icon name="ellipsis" size={14} />}
              label={`More for ${name}`}
              disabled={pending}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            />
          }
          items={[
            { heading: `Replace ${name} with` },
            ...KINDS.map((kind): MenuItem => ({
              label: `A new ${STAGE_KIND_NAMES[kind]}`,
              icon: <Icon name="arrow-left-right" size={14} />,
              onSelect: () =>
                onEdit(
                  withStageReplaced(stageChanges, built.rows, row.built, kind),
                  row.built.stage.key,
                ),
            })),
            { divider: true },
            {
              label: `Remove from ${projectName}'s Stages`,
              icon: <Icon name="trash-2" size={14} />,
              danger: true,
              onSelect: () => onEdit(withStageRemoved(stageChanges, row.built)),
            },
          ]}
        />
      )}
    </>
  );
}

/**
 * The Stage form on the row's Stage among the Stages a Task gets; its answer becomes a Stage change.
 * An inserted Stage also says where it goes; a Stage of the base Pipeline shows, under its form,
 * each field it changes beside the base Pipeline's value.
 */
function StageEditFields(
  props: RowProps & {
    readonly stages: readonly Stage[];
    readonly onEdit: (next: readonly StageChange[]) => void;
  },
): ReactNode {
  const { row, stages, stageChanges, onEdit, built, baseName, roles, options, commands } = props;
  const index = stages.findIndex(({ key }) => key === row.built.stage.key);
  const drafted = index < 0 ? stages : stages.with(index, stageDrafted(stageChanges, row.built));
  const fromBase = row.built.origin === "base" || row.built.origin === "changed";
  return (
    <>
      {fromBase ? (
        <p className="stage-changes-rules">
          <Icon name="info" size={13} />
          <span>
            From {baseName}: what you change here is a Change of only those fields, marked with{" "}
            {baseName}'s value. The rest follows {baseName}.
          </span>
        </p>
      ) : (
        row.built.origin === "inserted" && <WhereItGoes {...props} />
      )}
      <StageForm
        stages={drafted}
        index={index}
        onChange={(edited) => {
          const stage = edited[index];
          if (stage) onEdit(withStageEdited(stageChanges, row.built, stage));
        }}
        roles={roles}
        options={options}
        commands={commands}
      />
      {row.built.origin === "changed" && (
        <CompareTable {...props} stages={built.rows.map(({ stage }) => stage)} />
      )}
    </>
  );
}

/** Where it goes: an inserted Stage keeps beside the Stage it names when the base Pipeline changes. */
function WhereItGoes({
  row,
  built,
  stageChanges,
  baseName,
  onEdit,
}: RowProps & { readonly onEdit: (next: readonly StageChange[]) => void }): ReactNode {
  const places = insertPlaces(built.rows, stageChanges, row.built);
  const current =
    row.stageChange?.kind === "insert-before" || row.stageChange?.kind === "insert-after"
      ? `${row.stageChange.kind}:${row.stageChange.stageKey}`
      : "";
  return (
    <Select
      label="Where it goes"
      hint={`Kept beside this Stage when ${baseName} changes.`}
      value={current}
      options={places.map((place) => ({
        value: placeValue(place),
        label: `${place.kind === "insert-before" ? "Before" : "After"} ${place.stage.name}`,
      }))}
      onChange={(value) => {
        const place = places.find((candidate) => placeValue(candidate) === value);
        if (place) onEdit(withInsertPlaced(stageChanges, row.built, place));
      }}
    />
  );
}

/** A place as the Where it goes select's value: "insert-after:review". */
function placeValue(place: InsertPlace): string {
  return `${place.kind}:${place.stage.key}`;
}

/** A Change's fields: what the base Pipeline has, what the Project gets, and Set back on each. */
function CompareTable({
  row,
  stages,
  stageChanges,
  onEdit,
  baseName,
  projectName,
  roles,
  commands,
}: RowProps & { readonly stages: readonly Stage[] }): ReactNode {
  const { baseStage, stage, changedFields } = row.built;
  if (!baseStage) return null;
  const context: FieldWordsContext = {
    roles,
    stages,
    commands: commands && namedCommands(commands),
  };
  return (
    <div className="stage-changes-compare" role="table" aria-label={`What ${stage.name} changes`}>
      <div role="row" className="stage-changes-compare-head">
        <span role="columnheader">Field</span>
        <span role="columnheader">{baseName} has</span>
        <span role="columnheader">{projectName} gets</span>
        <span role="columnheader" />
      </div>
      {changedFields.map((field) => {
        const label = STAGE_FIELD_LABELS[field as StageField] ?? field;
        return (
          <div role="row" key={field}>
            <span role="rowheader" className="stage-changes-compare-label">
              {label}
            </span>
            <span role="cell" className="stage-changes-was" data-who={`${baseName} has`}>
              {fieldWords(baseStage, field as StageField, context)}
            </span>
            <span role="cell" className="stage-changes-now" data-who={`${projectName} gets`}>
              {fieldWords(stage, field as StageField, context)}
            </span>
            <span role="cell" className="stage-changes-set-back">
              {onEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  title={`Set ${label} back to ${baseName}'s`}
                  aria-label={`Set ${label} back to ${baseName}'s`}
                  iconLeft={<Icon name="undo-2" size={13} />}
                  onClick={() =>
                    onEdit(withFieldSetBack(stageChanges, row.built, field as StageField))
                  }
                >
                  Set back
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A Replace: the base Pipeline's Stage beside the one the Project gets. */
function ReplacedBy({
  row,
  baseStage,
  stages,
  baseName,
  projectName,
  roles,
  commands,
}: RowProps & { readonly baseStage: Stage; readonly stages: readonly Stage[] }): ReactNode {
  const named = commands && namedCommands(commands);
  const box = (title: string, stage: Stage): ReactNode => (
    <div>
      <span className="stage-changes-overline">{title}</span>
      <span>
        {STAGE_KIND_NAMES[stage.kind]} · {whoWorks(stage, roles, named)}
      </span>
      <span className="stage-changes-detail">{stageDetailsLine(stage, stages)}</span>
    </div>
  );
  return (
    <div className="stage-changes-replaced">
      {box(`${baseName}'s ${baseStage.name}`, baseStage)}
      {box(`${projectName} gets`, row.built.stage)}
    </div>
  );
}

/** A loop whose target is gone, or now comes after it, pointed at an earlier Stage or at you. */
function LoopFix({
  row,
  stage,
  stages,
  stageChanges,
  onEdit,
}: RowProps & {
  readonly stage: Exclude<Stage, { kind: "gate" }>;
  readonly stages: readonly Stage[];
  readonly onEdit: (next: readonly StageChange[]) => void;
}): ReactNode {
  const index = stages.findIndex(({ key }) => key === stage.key);
  const rounds = stage.onFailure?.rounds ?? 1;
  return (
    <span className="stage-changes-fix">
      <Select
        size="sm"
        label="On failure"
        placeholder="Choose…"
        value=""
        options={[
          { value: ASK_YOU, label: "Ask you" },
          ...failureTargets(stages, index).map((target) => ({
            value: target.key,
            label: `Go back to ${target.name}`,
          })),
        ]}
        onChange={(goBackTo) =>
          onEdit(
            withStageEdited(stageChanges, row.built, {
              ...stage,
              onFailure: goBackTo === ASK_YOU ? undefined : { goBackTo, rounds },
            }),
          )
        }
      />
    </span>
  );
}

/** The Stage changes that don't apply, with no row to sit on: each with why and its fix. */
function NotApplyingBlock({
  notApplying,
  live,
  baseName,
  stageChanges,
  built,
  pending = false,
  onFix,
}: StageChangesViewProps & {
  readonly notApplying: readonly NotApplying[];
  readonly live: readonly BuiltStage[];
  readonly onFix: ((next: readonly StageChange[]) => void) | undefined;
}): ReactNode {
  const title = `${counted(notApplying.length, "Stage change doesn't apply", "Stage changes don't apply")} to ${baseName}`;
  return (
    <div className="stage-changes-not-apply" role="group" aria-label={title}>
      <div className="stage-changes-not-apply-head">
        <Icon name="circle-alert" size={14} />
        {title}
      </div>
      {notApplying.map(({ index, stageChange, why, fix }) => (
        <div key={`${index}-${why}`} className="stage-changes-not-apply-item">
          <div className="stage-changes-what">
            <Badge size="sm" tone="warning">
              {STAGE_CHANGE_KIND_NAMES[stageChange.kind]}
            </Badge>
            {stageChange.stageName ?? stageChange.stageKey}
            {stageChange.kind === "change" && (
              <span className="stage-changes-detail">
                · {changedFieldsWords(Object.keys(stageChange.fields))}
              </span>
            )}
          </div>
          <div className="stage-changes-why">{why}</div>
          {onFix && (
            <div className="stage-changes-fix">
              {fix === "apply-to" ? (
                <>
                  <Select
                    size="sm"
                    label="Apply it to"
                    placeholder="Choose a Stage…"
                    value=""
                    disabled={pending}
                    options={live.map(({ stage }) => ({ value: stage.key, label: stage.name }))}
                    onChange={(key) => {
                      const target = live.find(({ stage }) => stage.key === key);
                      if (target)
                        onFix(withStageChangeAppliedTo(stageChanges, index, target.stage));
                    }}
                  />
                </>
              ) : (
                "stage" in stageChange && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => onFix(withOwnKey(stageChanges, index, built.rows))}
                  >
                    Give {stageChange.stage.name} a key of its own
                  </Button>
                )
              )}
              <span>or</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                iconLeft={<Icon name="trash-2" size={13} />}
                onClick={() => onFix(withoutStageChange(stageChanges, index))}
              >
                Remove this Stage change
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Insert, between two rows: a new Stage of a kind or a template's, beside the Stage above. */
function InsertPoint({
  at,
  built,
  stageChanges,
  pending = false,
  onEdit,
}: StageChangesViewProps & {
  readonly at: number;
  readonly onEdit: (next: readonly StageChange[], opened?: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const templates = useQuery({ ...stageTemplateQueries.list(), enabled: open });
  const place = insertPlace(built.rows, at);
  if (!place) return null;
  const label = `Insert ${place.kind === "insert-after" ? "after" : "before"} ${place.stage.name}`;
  const insert = (stage: Stage): void =>
    onEdit(withStageInserted(stageChanges, place, stage), stage.key);
  const listed = templates.data ?? [];
  return (
    <li className={`stage-changes-insert${open ? " open" : ""}`}>
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={240}
        trigger={
          <button
            type="button"
            className="stage-changes-insert-button"
            aria-label={label}
            title={label}
            disabled={pending}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Icon name="plus" size={11} />
            Insert
          </button>
        }
        items={[
          { heading: label },
          ...KINDS.map((kind): MenuItem => ({
            label: STAGE_KIND_NAMES[kind],
            icon: <Icon name={STAGE_KIND_ICONS[kind]} size={14} />,
            onSelect: () => insert(newStageAmong(built.rows, kind, stageChanges)),
          })),
          { divider: true },
          { heading: "From a template" },
          ...(listed.length > 0
            ? listed.map((template): MenuItem => ({
                label: template.stage.name,
                icon: <Icon name={STAGE_KIND_ICONS[template.stage.kind]} size={14} />,
                onSelect: () => insert(newStageAmong(built.rows, template, stageChanges)),
              }))
            : [
                {
                  label: templates.isPending
                    ? "Reading the Stage templates…"
                    : "No Stage template yet",
                  disabled: true,
                },
              ]),
        ]}
      />
    </li>
  );
}
