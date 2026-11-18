import { useQuery } from "@tanstack/react-query";
import type {
  Duty,
  Role,
  RoleCardOptions,
  Stage,
  StageChange,
  StageProblem,
} from "@the-office/contracts";
import { Button, Icon, Menu, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { stageTemplateQueries } from "../../../api/pipelines.ts";
import { whoWorks } from "../pipeline-words.ts";
import {
  newStageAmong,
  stageChangesShown,
  withStageInserted,
  type BuiltRows,
  type InsertPlace,
} from "../stage-change-edits.ts";
import { getsLine } from "../stage-change-words.ts";
import { namedCommands, type StageCommandSource } from "../stage-commands.ts";
import { STAGE_KIND_ICONS, STAGE_KIND_NAMES, type StageKind } from "../stage-edits.ts";
import { FlowEditor, useFlowEditorControls } from "./flow-editor.tsx";
import { projectHowToHint } from "./flow-editor-words.ts";
import { stageNamed } from "./flow-model.ts";
import { canvasEdited, type FlowEdited } from "./office-flow-edits.ts";
import { ProjectFlowBroken } from "./project-flow-broken.tsx";
import {
  projectFlowMarks,
  projectFlowProblems,
  projectFlowStages,
  projectStagesEdited,
} from "./project-flow-edits.ts";
import { ProjectFlowPanel } from "./project-flow-panel.tsx";
import "./project-flow.css";

const KINDS: readonly StageKind[] = ["agent", "script", "gate"];

export interface ProjectFlowEditorProps {
  /** Whose Stages these are, as "What the-office gets" names them. */
  readonly projectName: string;
  readonly baseName: string;
  /** The Stages as the service built them from the base Pipeline and `stageChanges`. */
  readonly built: BuiltRows;
  readonly stageChanges: readonly StageChange[];
  readonly onChange: (stageChanges: readonly StageChange[]) => void;
  /** What saving would be refused for, and what it only warns about, from the service's check. */
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  /** While the service's answer is for an earlier edit: the edits that need its rows wait. */
  readonly pending?: boolean;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** What a Script Stage and a route's command test may run: the Project's own commands. */
  readonly commands?: StageCommandSource;
}

/**
 * The flow editor as a Project page hosts it for a Project Pipeline (docs/design/pipeline-flow.html,
 * "A Project Pipeline as a flow"): what the Project gets, the built rows on the canvas with their
 * marks, Stages kept in the base Pipeline's places (no dragging); the Stage changes that don't apply
 * above it with their fixes; Insert before or after the picked Stage from the head; every other
 * edit made in the panel or on the canvas becomes a Stage change, which the service builds again.
 */
export function ProjectFlowEditor(props: ProjectFlowEditorProps): ReactNode {
  const { projectName, baseName, built, stageChanges, onChange, roles, duties, commands } = props;
  const controls = useFlowEditorControls();
  const shown = stageChangesShown(built, stageChanges, props.problems, props.warnings);
  const stages = projectFlowStages(built.rows, stageChanges);
  const live = stages.filter((_stage, at) => built.rows[at]?.origin !== "removed");
  const named = commands && namedCommands(commands);
  const apply = (edited: FlowEdited): void => {
    onChange(projectStagesEdited(stageChanges, built.rows, live, edited.stages));
    if ("pick" in edited) controls.pick(edited.pick);
    if (edited.hint !== undefined) controls.say(edited.hint);
  };
  const picked = controls.picked && stageNamed(live, controls.picked.key);
  const problems = projectFlowProblems(shown, props.problems);
  const baseStages = built.rows.filter(({ origin }) => origin !== "inserted").length;
  const insert = (place: InsertPlace, stage: Stage): void => {
    onChange(withStageInserted(stageChanges, place, stage));
    controls.pick({ kind: "stage", key: stage.key });
    controls.say(insertedHint(place, stage));
  };
  return (
    <div className="project-flow">
      <ProjectFlowBroken {...props} shown={shown} />
      <FlowEditor
        title={`What ${projectName} gets`}
        summary={getsLine(live.length, baseStages, baseName, stageChanges.length)}
        stages={stages}
        problems={problems}
        warnings={props.warnings}
        whoWorks={(stage) => whoWorks(stage, roles, named, duties)}
        draggable={false}
        marks={projectFlowMarks(shown, baseName)}
        legend={<ProjectLegend baseName={baseName} />}
        howTo={projectHowToHint}
        controls={controls}
        onEdit={(edit) => {
          if (edit.kind === "draw-route" || edit.kind === "remove-route") {
            apply(canvasEdited(live, edit));
          }
        }}
        head={
          <InsertMenu
            {...props}
            picked={picked}
            disabled={props.pending === true}
            onInsert={insert}
          />
        }
        panel={
          <ProjectFlowPanel
            {...props}
            shown={shown}
            stages={live}
            picked={controls.picked}
            onPick={controls.pick}
            onEdited={apply}
            problems={problems}
          />
        }
      />
    </div>
  );
}

function insertedHint(place: InsertPlace, stage: Stage): string {
  const beside = place.stage.name;
  return place.kind === "insert-after"
    ? `${stage.name} was inserted after ${beside}: it takes ${beside}'s routes out, and ${beside} gets one route to it.`
    : `${stage.name} was inserted before ${beside}: the routes into ${beside} lead to it, and it gets one route to ${beside}.`;
}

/** What the marks on a Stage's left edge mean, then the loop's line. */
function ProjectLegend({ baseName }: { readonly baseName: string }): ReactNode {
  return (
    <ul className="flow-editor-legend" aria-label="What the marks mean">
      <li>
        <span className="project-flow-edge" />
        From {baseName}
      </li>
      <li>
        <span className="project-flow-edge project-flow-edge--inserted" />
        Inserted
      </li>
      <li>
        <span className="project-flow-edge project-flow-edge--replaced" />
        Replaced
      </li>
      <li>
        <span className="project-flow-edge project-flow-edge--changed" />
        Changed or routes changed
      </li>
      <li>
        <span className="project-flow-edge project-flow-edge--removed" />
        Removed
      </li>
      <li>
        <span className="flow-editor-legend-line flow-editor-legend-line--loop" />
        On failure loop
      </li>
    </ul>
  );
}

/**
 * The head's menu: Insert after the picked Stage (a new Stage of a kind or a template's copy), or
 * before it; held until a Stage is picked.
 */
function InsertMenu({
  built,
  stageChanges,
  picked,
  disabled,
  onInsert,
}: ProjectFlowEditorProps & {
  readonly picked: Stage | undefined;
  readonly disabled: boolean;
  readonly onInsert: (place: InsertPlace, stage: Stage) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const templates = useQuery({ ...stageTemplateQueries.list(), enabled: open });
  const label = picked ? `Insert after ${picked.name}` : "Insert a Stage";
  if (!picked) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled
        title="Pick the Stage to insert after first"
        iconLeft={<Icon name="plus" size={12} />}
      >
        {label}
      </Button>
    );
  }
  const after: InsertPlace = { kind: "insert-after", stage: picked };
  const before: InsertPlace = { kind: "insert-before", stage: picked };
  const kinds = (place: InsertPlace, words: (kind: StageKind) => string): MenuItem[] =>
    KINDS.map((kind) => ({
      label: words(kind),
      icon: <Icon name={STAGE_KIND_ICONS[kind]} size={14} />,
      onSelect: () => onInsert(place, newStageAmong(built.rows, kind, stageChanges)),
    }));
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
          disabled={disabled}
          iconLeft={<Icon name="plus" size={12} />}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {label}
        </Button>
      }
      items={[
        { heading: `Insert after ${picked.name}` },
        ...kinds(after, (kind) => STAGE_KIND_NAMES[kind]),
        { divider: true },
        { heading: "From a template" },
        ...(listed.length > 0
          ? listed.map((template): MenuItem => ({
              label: template.stage.name,
              icon: <Icon name={STAGE_KIND_ICONS[template.stage.kind]} size={14} />,
              onSelect: () => onInsert(after, newStageAmong(built.rows, template, stageChanges)),
            }))
          : [
              {
                label: templates.isPending
                  ? "Reading the Stage templates…"
                  : "No Stage template yet",
                disabled: true,
              },
            ]),
        { divider: true },
        { heading: `Insert before ${picked.name}` },
        ...kinds(before, (kind) => `${STAGE_KIND_NAMES[kind]} before ${picked.name}`),
      ]}
    />
  );
}
