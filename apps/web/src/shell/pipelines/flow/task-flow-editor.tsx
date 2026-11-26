import { type ReactNode, useMemo } from "react";
import { whoWorks } from "../pipeline-words.ts";
import { namedCommands } from "../stage-commands.ts";
import { FlowAddMenu } from "./flow-add-menu.tsx";
import { FlowEditor, useFlowEditorControls } from "./flow-editor.tsx";
import { flowSummary } from "./flow-editor-words.ts";
import type { FlowLocks, FlowStageMark, FlowStageMarks } from "./flow-marks.ts";
import { FlowPanel } from "./flow-panel.tsx";
import { canvasEdited, draftAfter, type FlowEdited, stageAdded } from "./office-flow-edits.ts";
import type { OfficeFlowEditorProps } from "./office-flow-editor.tsx";

export interface TaskFlowEditorProps extends OfficeFlowEditorProps {
  /** The Task's started Stages (those with a run) by key, each with its state, such as "Done". */
  readonly started: ReadonlyMap<string, string>;
}

/**
 * The flow editor as "Edit for this Task" hosts it for the Task's own Stages: the office-wide
 * Pipeline's edits, with each started Stage locked (spec §2.3). A locked Stage shows its lock and
 * state, keeps its place in the order, and its fields and routes out read only; the order up to the
 * last started Stage is frozen, so a Stage added goes after them. Positions are never locked. What still breaks a lock,
 * such as a Stage put straight after a started one, the service's check names.
 */
export function TaskFlowEditor(props: TaskFlowEditorProps): ReactNode {
  const { stages, onChange, roles, duties, commands, started } = props;
  const named = commands && namedCommands(commands);
  const controls = useFlowEditorControls();
  const locked = useMemo(() => lockedNotes(started), [started]);
  const marks = useMemo(() => stateMarks(started), [started]);
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
      problemsTitle="These Stages can't be saved yet"
      whoWorks={(stage) => whoWorks(stage, roles, named, duties)}
      marks={marks}
      locked={locked}
      controls={controls}
      fullScreenName={props.fullScreenName}
      fullScreenBar={props.fullScreenBar}
      onEdit={(edit) => apply(canvasEdited(stages, edit, locked))}
      head={
        <FlowAddMenu
          label="Add a Stage"
          heading="Add a Stage"
          templates
          onAdd={(stage) => apply(stageAdded(stages, stage, controls.picked, locked))}
        />
      }
      panel={
        <FlowPanel
          {...props}
          locked={locked}
          picked={controls.picked}
          onPick={controls.pick}
          onEdited={apply}
        />
      }
    />
  );
}

function lockedNotes(started: ReadonlyMap<string, string>): FlowLocks {
  return new Map(
    [...started].map(([key, state]): [string, string] => [
      key,
      `${state}: started, so it can't be changed`,
    ]),
  );
}

function stateMarks(started: ReadonlyMap<string, string>): FlowStageMarks {
  return new Map(
    [...started].map(([key, label]): [string, FlowStageMark] => [key, { tone: "locked", label }]),
  );
}
