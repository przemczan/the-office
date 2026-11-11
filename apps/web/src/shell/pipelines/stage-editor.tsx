import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Role,
  RoleCardOptions,
  Stage,
  StageProblem,
  StageTemplate,
} from "@the-office/contracts";
import { Button, Icon, IconButton, Menu } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { addStageTemplate, stageTemplateQueries } from "../../api/pipelines.ts";
import { EFFORT_LABELS } from "../engine-words.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { thousands, whoWorks } from "./pipeline-words.ts";
import { StageCheckAlerts } from "./stage-check-alerts.tsx";
import {
  addStage,
  addStageFrom,
  canMove,
  moveStage,
  removeStage,
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  withoutFailureRule,
  type AddedStage,
} from "./stage-edits.ts";
import type { StageCommandSource } from "./stage-commands.ts";
import { StageForm } from "./stage-form.tsx";
import "./stage-editor.css";

export interface StageEditorProps {
  readonly stages: readonly Stage[];
  readonly onChange: (stages: readonly Stage[]) => void;
  /**
   * Where each Stage that has started stands, from the first: those are locked. Empty for a
   * library Pipeline, which no Task walks.
   */
  readonly lockedNotes: readonly string[];
  /** What saving would be refused for, from the service. */
  readonly problems: readonly StageProblem[];
  /** What the service flags but saves, such as a Role nobody fills in a library Pipeline. */
  readonly flags?: readonly StageProblem[];
  /** The problems' heading: what can't be saved. */
  readonly problemsTitle?: string;
  /** Everyone hired, who may work an Agent Stage when their Task limit isn't none. */
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  /** What a Script Stage may run: the Task's Project's commands, or every Project's. */
  readonly commands?: StageCommandSource;
}

/**
 * The Stage editor (spec §2.3): a Pipeline's Stages to add, drop, reorder and set, one open at a
 * time, with what the service would refuse, or only flags, marked on its Stage. One editor serves
 * "Edit for this Task" and the library.
 */
export function StageEditor(props: StageEditorProps): ReactNode {
  const {
    stages,
    onChange,
    lockedNotes,
    problems,
    flags = [],
    problemsTitle = "These Stages can't be saved yet",
  } = props;
  const [open, setOpen] = useState<number | undefined>();
  const lockedStages = lockedNotes.length;
  const flagged = new Set([...problems, ...flags].map(({ stageIndex }) => stageIndex));
  const openAdded = (added: AddedStage): void => {
    onChange(added.stages);
    setOpen(added.index);
  };
  return (
    <div className="stage-editor">
      <StageCheckAlerts problems={problems} flags={flags} problemsTitle={problemsTitle} />
      <ol className="stage-editor-stages" aria-label="Stages">
        {stages.map((stage, index) => (
          <StageEditorRow
            key={stage.key}
            {...props}
            index={index}
            lockedNote={lockedNotes[index]}
            flagged={flagged.has(index)}
            open={open === index}
            onToggle={() => setOpen(open === index ? undefined : index)}
            onMove={(by) => {
              onChange(moveStage(stages, index, by, lockedStages));
              if (open === index) setOpen(index + by);
            }}
            onRemove={() => {
              onChange(removeStage(stages, index));
              setOpen(undefined);
            }}
          />
        ))}
      </ol>
      <div className="stage-editor-add">
        <span>Add</span>
        {(["agent", "script", "gate"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="secondary"
            iconLeft={<Icon name={STAGE_KIND_ICONS[kind]} size={14} />}
            onClick={() => openAdded(addStage(stages, kind, lockedStages))}
          >
            {STAGE_KIND_NAMES[kind]}
          </Button>
        ))}
        <FromTemplateMenu
          onPick={(template) => openAdded(addStageFrom(stages, template, lockedStages))}
        />
      </div>
      <p className="stage-editor-rules">
        <Icon name="info" size={14} />
        Whatever the Pipeline, you are always asked when a round or budget limit is reached, a Stage
        fails with no retries left, the Definition of Done is not met after the last review, or an
        Agent reaches a hard switch.
      </p>
    </div>
  );
}

interface StageEditorRowProps extends StageEditorProps {
  readonly index: number;
  readonly lockedNote: string | undefined;
  readonly flagged: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}

function StageEditorRow(props: StageEditorRowProps): ReactNode {
  const { stages, index, lockedNote, flagged, open, onToggle, onMove, onRemove } = props;
  const savingAsTemplate = useSaveAsTemplate();
  const stage = stages[index];
  if (!stage) return null;
  const locked = lockedNote !== undefined;
  const lockedStages = props.lockedNotes.length;
  const name = shownName(stage);
  const classes = [
    "stage-editor-row",
    locked && "stage-editor-row-locked",
    open && "stage-editor-row-open",
    flagged && "stage-editor-row-flagged",
  ].filter(Boolean);
  return (
    <li className={classes.join(" ")} aria-label={name}>
      <span className="stage-editor-kind" title={STAGE_KIND_NAMES[stage.kind]}>
        <Icon name={STAGE_KIND_ICONS[stage.kind]} size={13} />
      </span>
      <div className="stage-editor-body">
        <button
          type="button"
          className="stage-editor-head"
          disabled={locked}
          aria-expanded={open}
          onClick={onToggle}
        >
          <StageSummary {...props} stage={stage} name={name} />
          {locked && <div className="stage-editor-detail">{lockedNote}</div>}
        </button>
        {open && !locked && <StageForm {...props} />}
        {savingAsTemplate.error && savingAsTemplate.variables && (
          <RefusalAlert
            // Named as sent: the Stage may be renamed since.
            title={`${shownName(savingAsTemplate.variables)} wasn't saved as a Stage template`}
            error={savingAsTemplate.error}
          />
        )}
      </div>
      {locked ? (
        <span className="stage-editor-lock" title="Already started">
          <Icon name="lock" size={14} />
        </span>
      ) : (
        <span className="stage-editor-tools">
          <IconButton
            size="sm"
            icon={<Icon name="arrow-up" size={14} />}
            label={`Move ${name} up`}
            disabled={!canMove(stages, index, -1, lockedStages)}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            icon={<Icon name="arrow-down" size={14} />}
            label={`Move ${name} down`}
            disabled={!canMove(stages, index, 1, lockedStages)}
            onClick={() => onMove(1)}
          />
          <IconButton
            size="sm"
            icon={<Icon name={open ? "chevron-up" : "pencil"} size={14} />}
            label={open ? `Done editing ${name}` : `Edit ${name}`}
            onClick={onToggle}
          />
          <IconButton
            size="sm"
            icon={<Icon name="bookmark-plus" size={14} />}
            label={`Save ${name} as a template`}
            disabled={savingAsTemplate.isPending}
            onClick={() => savingAsTemplate.mutate(stage)}
          />
          <IconButton
            size="sm"
            icon={<Icon name="trash-2" size={14} />}
            label={`Remove ${name}`}
            onClick={onRemove}
          />
        </span>
      )}
    </li>
  );
}

/**
 * "From a template": the Stage templates by name with their kind's icon, each added as a copy; with
 * none, where to make one.
 */
function FromTemplateMenu({
  onPick,
}: {
  readonly onPick: (template: StageTemplate) => void;
}): ReactNode {
  const templates = useQuery(stageTemplateQueries.list());
  const [open, setOpen] = useState(false);
  const listed = templates.data ?? [];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={260}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="bookmark" size={14} />}
          iconRight={<Icon name="chevron-down" size={14} />}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          From a template
        </Button>
      }
      items={
        listed.length > 0
          ? listed.map((template) => ({
              label: template.stage.name,
              icon: <Icon name={STAGE_KIND_ICONS[template.stage.kind]} size={14} />,
              onSelect: () => onPick(template),
            }))
          : [
              {
                label: templates.error
                  ? "The Stage templates can't be read"
                  : "No Stage template yet. Make one in Settings › Pipelines, or save a Stage as one.",
                disabled: true,
              },
            ]
      }
    />
  );
}

/** Save as template: the Stage added to the templates as it is, without its failure rule. */
function useSaveAsTemplate() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (stage: Stage) => addStageTemplate(withoutFailureRule(stage)),
    onSuccess: async ({ stage }) => {
      await queryClient.invalidateQueries(stageTemplateQueries.list());
      showToast(`${shownName(stage)} saved as a Stage template.`);
    },
  });
}

/** "Implement · Ada" over "fresh session · 250k budget · on failure back to …". */
function StageSummary({
  stage,
  stages,
  name,
  roles,
  commands,
}: StageEditorProps & { readonly stage: Stage; readonly name: string }): ReactNode {
  const onFailure = stage.kind !== "gate" ? stage.onFailure : undefined;
  const target = onFailure && stages.find(({ key }) => key === onFailure.goBackTo);
  const details = [
    stage.kind === "agent" &&
      (stage.session === "continue" ? "continues the session" : "fresh session"),
    stage.kind === "agent" && `${thousands(stage.budget)}k budget`,
    stage.kind === "agent" &&
      stage.effort !== undefined &&
      `effort ${EFFORT_LABELS[stage.effort].toLowerCase()}`,
    stage.kind === "agent" && stage.permissions !== undefined && "narrowed permission profile",
    stage.kind === "script" && stage.publishTarget === "branch-only" && "pushes the branch only",
    stage.kind === "script" &&
      stage.afterConflict === "review" &&
      stage.publishTarget !== "branch-only" &&
      "a resolved conflict waits for you",
    stage.optional && "optional",
    onFailure &&
      `on failure back to ${target?.name ?? onFailure.goBackTo}, at most ${onFailure.rounds}×`,
  ].filter((detail) => typeof detail === "string");
  return (
    <>
      <div className="stage-editor-name">
        {name}{" "}
        <span className="stage-editor-who">
          · {whoWorks(stage, roles, commands?.kind === "project" ? commands.commands : undefined)}
        </span>
      </div>
      {details.length > 0 && <div className="stage-editor-detail">{details.join(" · ")}</div>}
    </>
  );
}

/** A Stage's name, or its kind's while it has none. */
function shownName(stage: Stage): string {
  return stage.name.trim() || STAGE_KIND_NAMES[stage.kind];
}
