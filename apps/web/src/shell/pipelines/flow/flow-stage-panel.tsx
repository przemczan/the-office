import type { Stage } from "@the-office/contracts";
import { Icon, IconButton, Menu } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RefusalAlert } from "../../refusal-alert.tsx";
import { STAGE_KIND_ICONS, STAGE_KIND_NAMES } from "../stage-edits.ts";
import { StageForm } from "../stage-form.tsx";
import { shownName, useSaveAsTemplate } from "../use-save-as-template.ts";
import { FlowLockedFields, FlowLockedNote, lockedTitle } from "./flow-locked.tsx";
import { FlowOnFailure } from "./flow-on-failure.tsx";
import { canMoveStage, inFlowOrder, type MoveDirection, withStageMoved } from "./flow-model.ts";
import { NO_LOCKS } from "./flow-marks.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";
import { FlowRoutesOut } from "./flow-routes-out.tsx";
import { stageProblemsOf } from "./flow-view.ts";
import { stageRemoved } from "./office-flow-edits.ts";

const MOVES: readonly { direction: MoveDirection; icon: string }[] = [
  { direction: "earlier", icon: "chevron-left" },
  { direction: "later", icon: "chevron-right" },
  { direction: "up", icon: "chevron-up" },
  { direction: "down", icon: "chevron-down" },
];

/**
 * The picked Stage's panel: its place in the Pipeline's order with Move earlier, later, up and down
 * and its ⋯ menu; its fields as the Stage form has them; then Routes out and On failure. A locked
 * Stage's (a Task's started one) reads only: its Moves disabled, no ⋯ menu.
 */
export function FlowStagePanel(
  props: FlowPanelProps & { readonly stage: Stage; readonly onFailurePicked: boolean },
): ReactNode {
  const { stage, stages, onEdited, problems, locked = NO_LOCKS } = props;
  const name = shownName(stage);
  const note = locked.get(stage.key);
  const order = inFlowOrder(stages);
  const index = stages.indexOf(stage);
  const saving = useSaveAsTemplate();
  return (
    <section className="flow-panel" aria-label={name}>
      <div className="flow-panel-head">
        <h4 className="flow-panel-title">
          <span className={`flow-canvas-kind flow-canvas-kind--${stage.kind}`} aria-hidden="true">
            <Icon name={STAGE_KIND_ICONS[stage.kind]} size={11} />
          </span>
          {name}{" "}
          <small>
            {STAGE_KIND_NAMES[stage.kind]} · {order.indexOf(stage) + 1} of {order.length} in the
            Pipeline's order
          </small>
        </h4>
        <span className="flow-panel-tools">
          {MOVES.map(({ direction, icon }) => (
            <IconButton
              key={direction}
              size="sm"
              icon={<Icon name={icon} size={13} />}
              label={`Move ${name} ${direction}`}
              {...lockedTitle(note)}
              disabled={note !== undefined || !canMoveStage(stages, stage.key, direction, locked)}
              onClick={() =>
                onEdited({ stages: withStageMoved(stages, stage.key, direction, locked) })
              }
            />
          ))}
          {note === undefined && (
            <StageMenu
              name={name}
              saving={saving.isPending}
              onSave={() => saving.mutate(stage)}
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
        <FlowLockedFields note={note}>
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
        </FlowLockedFields>
        <FlowRoutesOut {...props} note={note} />
        {stage.kind !== "gate" && <FlowOnFailure {...props} stage={stage} note={note} />}
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
