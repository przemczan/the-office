import { useQuery } from "@tanstack/react-query";
import type {
  Duty,
  Role,
  RoleCardOptions,
  Stage,
  StageProblem,
  StageTemplate,
} from "@the-office/contracts";
import { Button, Icon, IconButton, Menu } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { stageTemplateQueries } from "../../api/pipelines.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { stageDetailsLine, whoWorks } from "./pipeline-words.ts";
import { StageCheckAlerts } from "./stage-check-alerts.tsx";
import {
  addStage,
  addStageFrom,
  canMove,
  moveStage,
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  type AddedStage,
} from "./stage-edits.ts";
import { addToFlow, isStraightLine, removeFromFlow, straightLine } from "./stage-routes.ts";
import { namedCommands, type StageCommandSource } from "./stage-commands.ts";
import { StageForm } from "./stage-form.tsx";
import { shownName, useSaveAsTemplate } from "./use-save-as-template.ts";
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
  /** What the service warns about but saves, such as a Role nobody fills in a library Pipeline. */
  readonly warnings?: readonly StageProblem[];
  /** The problems' heading: what can't be saved. */
  readonly problemsTitle?: string;
  /** Everyone hired, who may work an Agent Stage when their Task limit isn't none. */
  readonly roles: readonly Role[];
  /** Every duty with its holder, as an Agent Stage naming one is worked. */
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** What a Script Stage may run: the Task's Project's commands, or every Project's. */
  readonly commands?: StageCommandSource;
}

/**
 * The Stage editor (spec §2.3): a Pipeline's Stages to add, drop, reorder and set, one open at a
 * time, with what the service would refuse, or only warns about, marked on its Stage. One editor serves
 * "Edit for this Task" and the library.
 */
export function StageEditor(props: StageEditorProps): ReactNode {
  const {
    stages,
    onChange,
    lockedNotes,
    problems,
    warnings = [],
    problemsTitle = "These Stages can't be saved yet",
  } = props;
  const [open, setOpen] = useState<number | undefined>();
  const lockedStages = lockedNotes.length;
  const flagged = new Set([...problems, ...warnings].map(({ stageKey }) => stageKey));
  const straight = isStraightLine(stages);
  const openAdded = (added: AddedStage): void => {
    onChange(added.stages);
    setOpen(added.index);
  };
  return (
    <div className="stage-editor">
      <StageCheckAlerts problems={problems} warnings={warnings} problemsTitle={problemsTitle} />
      {!straight && (
        <p className="stage-editor-rules">
          <Icon name="info" size={14} />
          These Stages' routes aren't a straight line, so their order can be changed only once the
          flow editor comes. An added Stage goes after the last.
        </p>
      )}
      <ol className="stage-editor-stages" aria-label="Stages">
        {stages.map((stage, index) => (
          <StageEditorRow
            key={stage.key}
            {...props}
            index={index}
            lockedNote={lockedNotes[index]}
            flagged={flagged.has(stage.key)}
            straight={straight}
            open={open === index}
            onToggle={() => setOpen(open === index ? undefined : index)}
            onMove={(by) => {
              onChange(straightLine(moveStage(stages, index, by, lockedStages)));
              if (open === index) setOpen(index + by);
            }}
            onRemove={() => {
              onChange(removeFromFlow(stages, index));
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
            onClick={() => openAdded(addToFlow(stages, addStage(stages, kind, lockedStages)))}
          >
            {STAGE_KIND_NAMES[kind]}
          </Button>
        ))}
        <FromTemplateMenu
          onPick={(template) =>
            openAdded(addToFlow(stages, addStageFrom(stages, template, lockedStages)))
          }
        />
      </div>
      <p className="stage-editor-rules">
        <Icon name="info" size={14} />
        Whatever the Pipeline, you are always asked when a round or budget limit is reached, a Stage
        fails with no retries left, the Definition of Done is not met before Publish, or at the end
        without one, or an Agent reaches a hard switch.
      </p>
    </div>
  );
}

interface StageEditorRowProps extends StageEditorProps {
  readonly index: number;
  readonly lockedNote: string | undefined;
  readonly flagged: boolean;
  /** Whether the Stages are a straight line, the only flow whose order the list editor changes. */
  readonly straight: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}

function StageEditorRow(props: StageEditorRowProps): ReactNode {
  const { stages, index, lockedNote, flagged, straight, open, onToggle, onMove, onRemove } = props;
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
            disabled={!straight || !canMove(stages, index, -1, lockedStages)}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            icon={<Icon name="arrow-down" size={14} />}
            label={`Move ${name} down`}
            disabled={!straight || !canMove(stages, index, 1, lockedStages)}
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

/** "Implement · Ada" over "fresh session · 250k budget · on failure back to …". */
function StageSummary({
  stage,
  stages,
  name,
  roles,
  duties,
  commands,
}: StageEditorProps & { readonly stage: Stage; readonly name: string }): ReactNode {
  const details = stageDetailsLine(stage, stages);
  return (
    <>
      <div className="stage-editor-name">
        {name}{" "}
        <span className="stage-editor-who">
          · {whoWorks(stage, roles, commands && namedCommands(commands), duties)}
        </span>
      </div>
      {details !== "" && <div className="stage-editor-detail">{details}</div>}
    </>
  );
}
