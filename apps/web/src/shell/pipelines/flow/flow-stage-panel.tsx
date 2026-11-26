import type { Stage } from "@the-office/contracts";
import { Icon, IconButton, Menu } from "@the-office/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RefusalAlert } from "../../refusal-alert.tsx";
import { STAGE_KIND_ICONS, STAGE_KIND_NAMES } from "../stage-edits.ts";
import { StageForm } from "../stage-form.tsx";
import { shownName, useSaveAsTemplate } from "../use-save-as-template.ts";
import { FlowLockedFields, FlowLockedNote } from "./flow-locked.tsx";
import { canMoveStage, type MoveDirection } from "./flow-model.ts";
import { NO_LOCKS } from "./flow-marks.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";
import { FlowRoutesOut } from "./flow-routes-out.tsx";
import { FlowTemplateLine } from "./flow-template-line.tsx";
import { stageProblemsOf } from "./flow-view.ts";
import { stageMoved, stageRemoved } from "./office-flow-edits.ts";

const MOVES: readonly {
  direction: MoveDirection;
  icon: string;
  tooltip: string;
  already: string;
}[] = [
  {
    direction: "earlier",
    icon: "chevron-left",
    tooltip: "Earlier in the Pipeline's order; it stays where it is on the canvas",
    already: "first",
  },
  {
    direction: "later",
    icon: "chevron-right",
    tooltip: "Later in the Pipeline's order; it stays where it is on the canvas",
    already: "last",
  },
];

/** A started Stage's Move, disabled. */
const STARTED_KEEPS_ITS_PLACE = "Started, so it keeps its place in the order";

/**
 * The picked Stage's panel: its place in the Pipeline's order with Move earlier and Move later
 * (which change the order alone, never where it stands on the canvas) and its ⋯ menu; its link to its Stage template, if any, on a Pipeline's Stages only (`links`: a
 * Task's own Stages are copies), and its fields as the Stage form has them; then Routes out. A locked Stage's (a Task's started one) reads only: its Moves disabled, no ⋯
 * menu.
 */
export function FlowStagePanel(props: FlowPanelProps & { readonly stage: Stage }): ReactNode {
  const { stage, stages, onEdited, problems, locked = NO_LOCKS } = props;
  const name = shownName(stage);
  const note = locked.get(stage.key);
  const index = stages.indexOf(stage);
  const saving = useSaveAsTemplate();
  // The draft as it is once the template is saved, which edits made meanwhile may have changed.
  const latest = useRef(stages);
  useLayoutEffect(() => {
    latest.current = stages;
  });
  const linkTo = (templateId: string): void =>
    onEdited({
      stages: latest.current.map((each) =>
        each.key === stage.key ? { ...each, templateId } : each,
      ),
    });
  return (
    <section className="flow-panel" aria-label={name}>
      <div className="flow-panel-head">
        <h4 className="flow-panel-title">
          <span className={`flow-canvas-kind flow-canvas-kind--${stage.kind}`} aria-hidden="true">
            <Icon name={STAGE_KIND_ICONS[stage.kind]} size={11} />
          </span>
          {name}{" "}
          <small>
            {STAGE_KIND_NAMES[stage.kind]} · {index + 1} of {stages.length} in the Pipeline's order
          </small>
        </h4>
        <span className="flow-panel-tools">
          {MOVES.map(({ direction, icon, tooltip, already }) => {
            const can = note === undefined && canMoveStage(stages, stage.key, direction, locked);
            const why =
              note !== undefined || locked.has(stage.key)
                ? STARTED_KEEPS_ITS_PLACE
                : !can && (direction === "earlier" ? index === 0 : index === stages.length - 1)
                  ? `${name} is already ${already}`
                  : !can
                    ? STARTED_KEEPS_ITS_PLACE
                    : tooltip;
            return (
              <IconButton
                key={direction}
                size="sm"
                icon={<Icon name={icon} size={13} />}
                label={`Move ${name} ${direction}`}
                title={why}
                disabled={!can}
                onClick={() => onEdited(stageMoved(stages, stage.key, direction, locked))}
              />
            );
          })}
          {note === undefined && (
            <StageMenu
              name={name}
              saving={saving.isPending}
              onSave={() =>
                saving.mutate(stage, {
                  onSuccess: ({ id }) => {
                    if (props.links) linkTo(id);
                  },
                })
              }
              onRemove={() => onEdited(stageRemoved(stages, stage.key, locked))}
            />
          )}
        </span>
      </div>
      <div className="flow-panel-body">
        {note !== undefined && <FlowLockedNote note={note} />}
        <FlowProblemAlert problems={stageProblemsOf(problems, stage.key)} />
        {saving.error && saving.variables && (
          <RefusalAlert
            // Named as sent: the Stage may be renamed since.
            title={`${shownName(saving.variables)} wasn't saved as a Stage template`}
            error={saving.error}
          />
        )}
        {props.links && (
          <FlowTemplateLine
            stage={stage}
            disabled={note !== undefined}
            onChange={(changed) =>
              onEdited({ stages: stages.map((each) => (each.key === stage.key ? changed : each)) })
            }
          />
        )}
        <FlowLockedFields note={note}>
          <StageForm
            stages={stages}
            index={index}
            onChange={(changed) => onEdited({ stages: changed })}
            roles={props.roles}
            duties={props.duties}
            options={props.options}
            commands={props.commands}
          />
        </FlowLockedFields>
        <FlowRoutesOut {...props} note={note} />
      </div>
    </section>
  );
}

/** ⋯: Save as a template and Remove. */
function StageMenu({
  name,
  saving,
  onSave,
  onRemove,
}: {
  readonly name: string;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={240}
      trigger={
        <IconButton
          size="sm"
          icon={<Icon name="ellipsis" size={14} />}
          label={`More for ${name}`}
          aria-haspopup="menu"
          aria-expanded={open}
        />
      }
      items={[
        {
          label: `Save ${name} as a template`,
          icon: <Icon name="bookmark-plus" size={14} />,
          disabled: saving,
          onSelect: onSave,
        },
        {
          label: `Remove ${name}`,
          icon: <Icon name="trash-2" size={14} />,
          danger: true,
          onSelect: onRemove,
        },
      ]}
    />
  );
}
