import type {
  Duty,
  Role,
  RoleCardOptions,
  Stage,
  StagePosition,
  StageProblem,
} from "@the-office/contracts";
import type { ReactNode } from "react";
import { whoWorks } from "../pipeline-words.ts";
import { namedCommands, type StageCommandSource } from "../stage-commands.ts";
import { FlowAddMenu } from "./flow-add-menu.tsx";
import { FlowEditor, useFlowEditorControls } from "./flow-editor.tsx";
import { flowSummary } from "./flow-editor-words.ts";
import { FlowPanel } from "./flow-panel.tsx";
import { canvasEdited, draftAfter, type FlowEdited, stageAdded } from "./office-flow-edits.ts";

export interface OfficeFlowEditorProps {
  /** The flow, as `asFlow` gives it: every Stage, in the Pipeline's order, with its position and routes. */
  readonly stages: readonly Stage[];
  /** Where End stands; derived, right of the right-most Stage, without. */
  readonly endPosition?: StagePosition | undefined;
  /** The Stages and End's position after an edit. */
  readonly onChange: (stages: readonly Stage[], endPosition: StagePosition | undefined) => void;
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** Every Project's commands, which a Script Stage and a command test pick a key from. */
  readonly commands?: StageCommandSource;
  /** In full screen, before the title, such as "Full ·". */
  readonly fullScreenName?: string;
  /** In full screen, under the panel: the host's Save. */
  readonly fullScreenBar?: ReactNode;
  /** The key of the Stage the editor opens picked, as the address's `?stage=` names it. */
  readonly pickedStage?: string | undefined;
}

/**
 * The flow editor as Settings › Pipelines hosts it for an office-wide Pipeline: every edit, from
 * the canvas, the head's Add a Stage or the panel, applied to its Stages with flow-model. Its Stages
 * are a Pipeline's, so one added from a Stage template, or saved as one, is linked to it.
 */
export function OfficeFlowEditor(props: OfficeFlowEditorProps): ReactNode {
  const { stages, onChange, roles, duties, commands } = props;
  const named = commands && namedCommands(commands);
  const controls = useFlowEditorControls(
    props.pickedStage === undefined ? undefined : { kind: "stage", key: props.pickedStage },
  );
  const apply = (edited: FlowEdited): void => {
    const draft = draftAfter(edited, props.endPosition);
    onChange(draft.stages, draft.endPosition);
    controls.took(edited);
  };
  return (
    <FlowEditor
      title="Stages and routes"
      summary={flowSummary(stages)}
      stages={stages}
      endPosition={props.endPosition}
      problems={props.problems}
      warnings={props.warnings}
      whoWorks={(stage) => whoWorks(stage, roles, named, duties)}
      controls={controls}
      fullScreenName={props.fullScreenName}
      fullScreenBar={props.fullScreenBar}
      onEdit={(edit) => apply(canvasEdited(stages, edit))}
      head={
        <FlowAddMenu
          label="Add a Stage"
          heading="Add a Stage"
          templates
          links
          onAdd={(stage) => apply(stageAdded(stages, stage, controls.picked))}
        />
      }
      panel={
        <FlowPanel
          {...props}
          links
          picked={controls.picked}
          onPick={controls.pick}
          onEdited={apply}
        />
      }
    />
  );
}
