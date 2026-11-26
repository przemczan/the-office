import { useQuery } from "@tanstack/react-query";
import {
  countedTokens,
  type Pipeline,
  type Role,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { BlockLoader, BlockLoaderOrProblem, type BlockRead } from "../../shell/block-loader.tsx";
import { useProjectPipelineChoices } from "../../shell/pipelines/use-pipelines.ts";
import { TokenFigure } from "../../shell/token-count.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";
import { publishingWaitWords } from "./initiative-words.ts";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { StageHistoryWindow } from "./stage-history-window.tsx";
import { StageMark } from "./stage-mark.tsx";
import { focusStage, stageElementId } from "./stage-selection.ts";
import { StageWorker } from "./stage-worker.tsx";
import { pipelineProgress, type ProgressStage } from "./pipeline-progress.ts";
import {
  railCaption,
  railRunsWords,
  railScrollLeft,
  railStateWords,
  roundWords,
  stageWaitsForRunEnvironment,
  stagesOnRail,
} from "./stage-rail-words.ts";
import type { ShownStage } from "./use-stage-history.ts";
import {
  PIPELINE_NOT_CHOSEN,
  PIPELINE_NOT_CHOSEN_WORDS,
  PIPELINE_RAIL_ELEMENT_ID,
  pipelineLabel,
  REMOVED_PIPELINE,
  stageNamesOf,
  type StageNames,
} from "./stage-words.ts";

/** How narrow a Stage's column gets; below that the rail scrolls. */
const STAGE_MIN_WIDTH_PX = 150;

/** Where the markers sit in the rail: under the room the "Now" tag takes. */
const MARKER_TOP_PX = 26;

/** From a marker's top to the top of the line through its centre. */
const LINE_FROM_MARKER_TOP_PX = 11;

/** The id of the Open diagram button, which the diagram window returns focus to as it closes. */
export const OPEN_DIAGRAM_BUTTON_ID = "open-pipeline-diagram";

/** Where the Task is: every Stage, in order, from its library Pipeline until it has its own copy. */
export function PipelineRail({
  task,
  pipeline,
  shown,
  onSelect,
  onCloseHistory,
  onOpenDiagram,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  /** The Stage whose history is open; the page holds it, as a chapter's link and the address select too. */
  readonly shown: ShownStage | undefined;
  readonly onSelect: (stageKey: string) => void;
  readonly onCloseHistory: () => void;
  /** The page holds whether the diagram window is open. */
  readonly onOpenDiagram: () => void;
}): ReactNode {
  const taskStagesRead = useQuery(pipelineQueries.taskStages(task.id));
  const roles = useQuery(roleQueries.list()).data;
  const [editing, setEditing] = useState(false);
  const taskStages = taskStagesRead.data;
  // Until the Task's Stages are read, the library's would show a started Task as not started.
  if (!taskStages) return <RailLoader reads={[taskStagesRead]} />;
  if (task.pipelineId === null) return <NotChosenRail task={task} />;
  const stages = stagesOnRail(taskStages.stages, pipeline?.stages);
  const finished = task.state === "done" || task.state === "dropped";
  const label = `Pipeline · ${pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, taskStages.editedForTask)}`;
  const proposal = (
    <>
      <PublishingWait task={task} />
      {!taskStages.editedForTask && (
        <BrokenPipelineFlag task={task} onChooseAnother={() => setEditing(true)} />
      )}
      <PipelineProposal task={task} pipeline={pipeline} />
    </>
  );
  const editAction = !finished && task.state !== "shaping" && (
    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
      Edit for this Task
    </Button>
  );
  const diagramAction = (
    <Button
      id={OPEN_DIAGRAM_BUTTON_ID}
      size="sm"
      variant="ghost"
      iconLeft={<Icon name="workflow" size={12} />}
      aria-haspopup="dialog"
      onClick={onOpenDiagram}
    >
      Open diagram
    </Button>
  );
  const actions = (
    <span className="pipeline-rail-actions">
      {diagramAction}
      {editAction}
    </span>
  );
  return (
    <>
      {stages.length > 0 ? (
        <StageTrack
          label={label}
          action={actions}
          proposal={proposal}
          stages={stages}
          task={task}
          roles={roles}
          shown={shown}
          onSelect={onSelect}
          onCloseHistory={onCloseHistory}
        />
      ) : (
        <section className="pipeline-rail-place" aria-label={label}>
          <div className="pipeline-rail">
            <RailTop label={label} action={editAction} />
            <p className="pipeline-rail-removed">Its Pipeline was removed from the library.</p>
            {proposal}
          </div>
        </section>
      )}
      {editing && <EditTaskStagesDialog task={task} onClose={() => setEditing(false)} />}
    </>
  );
}

/** The rail's place while what it shows is read: Stages in its frame, or the read's problem. */
export function RailLoader({ reads }: { readonly reads: readonly BlockRead[] }): ReactNode {
  return (
    <div className="pipeline-rail-place">
      {reads.some(({ error }) => error !== null) ? (
        <BlockLoaderOrProblem reads={reads} shape="rail" />
      ) : (
        <div className="pipeline-rail">
          <BlockLoader shape="rail" label="Loading the Pipeline…" />
        </div>
      )}
    </div>
  );
}

/**
 * What a started Publishing Task waits for before its next Stage (spec 2.1): a Task added to its
 * Initiative or moved into its Project, neither Done nor Dropped yet.
 */
export function PublishingWait({ task }: { readonly task: Task }): ReactNode {
  const tasks = useQuery(taskQueries.list()).data;
  const wait = tasks && publishingWaitWords(task, tasks);
  return wait ? <p className="pipeline-rail-wait">{wait}</p> : null;
}

/**
 * A Task that hasn't started on a Project Pipeline that was Broken before The Office updated, not
 * saved since, with no Stages edited for it, can't start (spec §2.3.5, "The move to routes back and
 * Publish Stages"): said with why, and another Pipeline offered.
 */
function BrokenPipelineFlag({
  task,
  onChooseAnother,
}: {
  readonly task: Task;
  readonly onChooseAnother: () => void;
}): ReactNode {
  const choices = useProjectPipelineChoices(task.projectId);
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const broken = choices?.projectPipelines.find(
    ({ id, brokenBeforeUpdate }) => id === task.pipelineId && brokenBeforeUpdate !== null,
  );
  if (!broken || !NOT_STARTED.includes(task.state)) return null;
  const projectName = project?.name ?? "its Project";
  return (
    <Alert
      tone="warning"
      title={`${broken.name} was Broken before The Office updated`}
      action={
        <Button size="sm" variant="secondary" onClick={onChooseAnother}>
          Choose another Pipeline
        </Button>
      }
    >
      {broken.brokenBeforeUpdate?.join(" ")} The Task can&apos;t start until it is saved in{" "}
      {projectName}&apos;s Pipelines, or another Pipeline is chosen for it.
    </Alert>
  );
}

/**
 * A Task with no Pipeline yet has no Stages to show: a placeholder, and the Planner's proposal once
 * there is one; in Backlog the user chooses one here.
 */
function NotChosenRail({ task }: { readonly task: Task }): ReactNode {
  const [choosing, setChoosing] = useState(false);
  const label = `Pipeline · ${PIPELINE_NOT_CHOSEN}`;
  return (
    <section id={PIPELINE_RAIL_ELEMENT_ID} className="pipeline-rail-place" aria-label={label}>
      <div className="pipeline-rail pipeline-rail-not-chosen">
        <RailTop label={label} action={undefined} />
        <div className="pipeline-rail-not-chosen-body">
          <p>{PIPELINE_NOT_CHOSEN_WORDS}</p>
          {task.state === "backlog" && (
            <Button onClick={() => setChoosing(true)}>Choose a Pipeline</Button>
          )}
        </div>
        <PipelineProposal task={task} pipeline={undefined} />
      </div>
      {choosing && <EditTaskStagesDialog task={task} onClose={() => setChoosing(false)} />}
    </section>
  );
}

function RailTop({
  label,
  caption,
  action,
}: {
  readonly label: string;
  readonly caption?: string;
  readonly action: ReactNode;
}): ReactNode {
  return (
    <div className="pipeline-rail-top">
      <span className="overline">{label}</span>
      {caption !== undefined && <span className="pipeline-rail-caption">{caption}</span>}
      {action}
    </div>
  );
}

/**
 * The caption, the Stages on their line and the selected Stage's history window. Equal columns put
 * each marker at a known share of the width, so the line and how far it is filled need no measuring.
 */
function StageTrack({
  label,
  action,
  proposal,
  stages,
  task,
  roles,
  shown,
  onSelect,
  onCloseHistory,
}: {
  readonly label: string;
  readonly action: ReactNode;
  /** The Planner's Pipeline proposal, at the rail's foot. */
  readonly proposal: ReactNode;
  readonly stages: readonly TaskStage[];
  readonly task: Task;
  readonly roles: readonly Role[] | undefined;
  readonly shown: ShownStage | undefined;
  readonly onSelect: (stageKey: string) => void;
  readonly onCloseHistory: () => void;
}): ReactNode {
  const now = useClock();
  const names = stageNamesOf(stages.map(({ stage }) => stage));
  const progress = useMemo(() => pipelineProgress(stages, task.state), [stages, task.state]);
  const current = progress.stages.findIndex(
    ({ taskStage }) => taskStage.stage.key === progress.currentKey,
  );
  const scroller = useCurrentStageInView(current, progress.stages.length);
  // The ← → keys and the Pipeline in small follow the rail's order, not the Pipeline's.
  const inRailOrder = useMemo(() => progress.stages.map(({ taskStage }) => taskStage), [progress]);
  const reachedCount = progress.stages.filter(({ reached }) => reached).length;
  const firstMarker = 50 / stages.length;
  // A Stage edited away since it was selected leaves nothing selected.
  const selected = stages.find(({ stage }) => stage.key === shown?.stageKey);

  const lineTop = MARKER_TOP_PX + LINE_FROM_MARKER_TOP_PX;
  const lastReached = progress.stages[reachedCount - 1]?.taskStage;
  const reachedRunning =
    lastReached?.stage.key === progress.currentKey && lastReached?.state === "running";
  return (
    <section className="pipeline-rail-place" aria-label={label}>
      <div className="pipeline-rail">
        <RailTop
          label={label}
          caption={`${railCaption(progress, task.state)} · select a Stage for its history`}
          action={action}
        />
        <div className="pipeline-rail-scroll" ref={scroller}>
          <div
            className="pipeline-rail-stages"
            style={{
              minWidth: `max(100%, ${stages.length * STAGE_MIN_WIDTH_PX}px)`,
              paddingTop: MARKER_TOP_PX,
            }}
          >
            <span
              className="pipeline-rail-line"
              style={{ top: lineTop, left: `${firstMarker}%`, right: `${firstMarker}%` }}
            />
            <span
              className={`pipeline-rail-reached${reachedRunning ? " pipeline-rail-reached-live" : ""}`}
              style={{
                top: lineTop,
                left: `${firstMarker}%`,
                width: `${(Math.max(reachedCount - 1, 0) * 100) / stages.length}%`,
              }}
            />
            <ol aria-label="Stages">
              {progress.stages.map((progressStage, index) => (
                <RailStage
                  key={progressStage.taskStage.stage.key}
                  progressStage={progressStage}
                  walkStarted={progress.started}
                  isCurrent={index === current}
                  isSelected={progressStage.taskStage === selected}
                  roles={roles}
                  names={names}
                  now={now}
                  onSelect={() => onSelect(progressStage.taskStage.stage.key)}
                />
              ))}
            </ol>
          </div>
        </div>
        {proposal}
      </div>
      {selected && (
        <StageHistoryWindow
          taskId={task.id}
          stages={inRailOrder}
          taskStage={selected}
          askedRunId={shown?.askedRunId}
          noRunsWords={
            NOT_STARTED.includes(task.state) ? "Runs once the Task starts." : "Hasn't run yet."
          }
          roles={roles}
          names={names}
          onSelect={onSelect}
          onClose={() => {
            onCloseHistory();
            focusStage(selected.stage.key);
          }}
        />
      )}
    </section>
  );
}

/**
 * Keeps the current Stage in the rail's view when the Stages don't fit: when the Task moves on and
 * when the rail changes width, and otherwise leaves a reader's scrolling alone. Only `scrollLeft`
 * moves, as scrollIntoView would scroll the page too.
 */
function useCurrentStageInView(
  current: number,
  stageCount: number,
): RefObject<HTMLDivElement | null> {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = scroller.current;
    if (view === null || current < 0) return;
    let width: number | undefined;
    // It reports once on being observed, which is the Task moving on; its height changes too.
    const resizing = new ResizeObserver(() => {
      if (view.clientWidth === width) return;
      width = view.clientWidth;
      view.scrollLeft = railScrollLeft(current, stageCount, view.scrollWidth, width);
    });
    resizing.observe(view);
    return () => resizing.disconnect();
  }, [current, stageCount]);
  return scroller;
}

function RailStage({
  progressStage,
  walkStarted,
  isCurrent,
  isSelected,
  roles,
  names,
  now,
  onSelect,
}: {
  readonly progressStage: ProgressStage;
  readonly walkStarted: boolean;
  readonly isCurrent: boolean;
  readonly isSelected: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
  readonly onSelect: () => void;
}): ReactNode {
  const { taskStage, reached } = progressStage;
  const { stage, state, tokens } = taskStage;
  const wordsId = `rail-words-${stage.key}`;
  return (
    <li
      className={`pipeline-rail-stage pipeline-rail-stage-${state} pipeline-rail-stage-kind-${stage.kind}${isSelected ? " pipeline-rail-stage-selected" : ""}${reached ? "" : " pipeline-rail-stage-ahead"}`}
    >
      {isCurrent && <NowTag state={state} />}
      <StageMark taskStage={taskStage} />
      <span className="pipeline-rail-body">
        <span className="pipeline-rail-name">
          {/* Stretched over the column, so what else in it is a control stays one of its own. */}
          <button
            type="button"
            id={stageElementId(stage.key)}
            className="pipeline-rail-button"
            aria-haspopup="dialog"
            aria-describedby={wordsId}
            aria-current={isCurrent ? "step" : undefined}
            onClick={onSelect}
          >
            {stage.name}
          </button>
        </span>
        <span className="pipeline-rail-worker">
          <StageWorker taskStage={taskStage} roles={roles} />
        </span>
        <span id={wordsId} className="pipeline-rail-words">
          <span className="pipeline-rail-state">
            {state === "running" && !stageWaitsForRunEnvironment(taskStage) && (
              <span className="live-dot" />
            )}
            {railStateWords(taskStage, names)}
          </span>
          <span className="pipeline-rail-runs">
            {railRunsWords(taskStage, walkStarted, now)}
            {stage.kind === "agent" && countedTokens(tokens) > 0 && (
              <>
                {" · "}
                <TokenFigure tokens={tokens} />
              </>
            )}
          </span>
          <RoundChip progressStage={progressStage} />
        </span>
      </span>
    </li>
  );
}

/**
 * The current Stage's tag, over its mark in its state's colour. Hidden from assistive technology,
 * which hears `aria-current="step"` on the Stage's button.
 */
export function NowTag({ state }: { readonly state: TaskStage["state"] }): ReactNode {
  return (
    <span className={`pipeline-rail-now pipeline-rail-now-${state}`} aria-hidden="true">
      Now
    </span>
  );
}

/** The round count of a Stage the work came back to: once on the Stage, never a repeated column. */
export function RoundChip({ progressStage }: { readonly progressStage: ProgressStage }): ReactNode {
  const words = roundWords(progressStage);
  if (words === "") return null;
  const onLastRound = progressStage.roundBound === progressStage.rounds;
  return (
    <span className={`pipeline-rail-round${onLastRound ? " pipeline-rail-round-last" : ""}`}>
      <Icon name="rotate-ccw" size={11} />
      <span aria-hidden="true">{words}</span>
      <span className="visually-hidden">{roundWords(progressStage, true)}</span>
    </span>
  );
}
