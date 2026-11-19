import type { Duty, Role, RoleCardOptions, Stage, StageProblem } from "@the-office/contracts";
import type { ReactNode } from "react";
import { whoWorks } from "../pipeline-words.ts";
import { namedCommands, type StageCommandSource } from "../stage-commands.ts";
import { FlowAddMenu } from "./flow-add-menu.tsx";
import { FlowEditor, useFlowEditorControls } from "./flow-editor.tsx";
import { flowSummary } from "./flow-editor-words.ts";
import { FlowPanel } from "./flow-panel.tsx";
import { canvasEdited, type FlowEdited, stageAdded } from "./office-flow-edits.ts";

export interface OfficeFlowEditorProps {
  /** The flow, as `asFlow` gives it: every Stage with its place and routes. */
  readonly stages: readonly Stage[];
  readonly onChange: (stages: readonly Stage[]) => void;
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
}

/**
 * The flow editor as Settings › Pipelines hosts it for an office-wide Pipeline: every edit, from
 * the canvas, the List, the head's Add a Stage or the panel, applied to its Stages with flow-model.
 */
export function OfficeFlowEditor(props: OfficeFlowEditorProps): ReactNode {
  const { stages, onChange, roles, duties, commands } = props;
  const named = commands && namedCommands(commands);
  const controls = useFlowEditorControls();
  const apply = (edited: FlowEdited): void => {
    onChange(edited.stages);
    if ("pick" in edited) controls.pick(edited.pick);
    if (edited.hint !== undefined) controls.say(edited.hint);
  };
  return (
    <FlowEditor
      title="Stages and routes"
      summary={flowSummary(stages)}
      stages={stages}
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
          onAdd={(stage) => apply(stageAdded(stages, stage, controls.picked))}
        />
      }
      panel={
        <FlowPanel {...props} picked={controls.picked} onPick={controls.pick} onEdited={apply} />
      }
    />
  );
}
