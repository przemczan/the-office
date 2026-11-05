import { useQuery } from "@tanstack/react-query";
import {
  countedTokens,
  type Pipeline,
  type Role,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { TokenFigure } from "../../shell/token-count.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { StageHistoryWindow } from "./stage-history-window.tsx";
import { StageMark } from "./stage-mark.tsx";
import { focusStage, stageElementId } from "./stage-selection.ts";
import { StageWorker } from "./stage-worker.tsx";
import {
  currentStageIndex,
  loopBackEnds,
  loopBackPath,
  loopBacks,
  loopBackWords,
  railCaption,
  railRunsWords,
  railScrollLeft,
  railStateWords,
  stagesOnRail,
  type LoopBack,
  type LoopBackEnd,
  type RailPlace,
} from "./stage-rail-words.ts";
import type { ShownStage } from "./use-stage-history.ts";
import { pipelineLabel, REMOVED_PIPELINE, stageNamesOf, type StageNames } from "./stage-words.ts";

/** How narrow a Stage's column gets; below that the rail scrolls. */
const STAGE_MIN_WIDTH_PX = 150;

/** Where the markers sit in the rail, with no arcs over them. */
const MARKER_TOP_PX = 14;

/** From a marker's top to the top of the line through its centre. */
const LINE_FROM_MARKER_TOP_PX = 11;

/** The room over the markers once there are arcs: what they start from, and what each height adds. */
const ARC_ROOM_PX = 26;
const ARC_ROOM_PER_LEVEL_PX = 16;

/** Where the Task is: every Stage, in order, from its library Pipeline until it has its own copy. */
export function PipelineRail({
  task,
  pipeline,
  shown,
  onSelect,
  onCloseHistory,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  /** The Stage whose history is open; the page holds it, as a chapter's link and the address select too. */
  readonly shown: ShownStage | undefined;
  readonly onSelect: (stageKey: string) => void;
  readonly onCloseHistory: () => void;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const [editing, setEditing] = useState(false);
  // Until the Task's Stages are read, the library's would show a started Task as not started.
  if (!taskStages) return null;
  const stages = stagesOnRail(taskStages.stages, pipeline?.stages);
  const finished = task.state === "done" || task.state === "dropped";
  const label = `Pipeline · ${pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, taskStages.editedForTask)}`;
  const proposal = <PipelineProposal task={task} pipeline={pipeline} />;
  const editAction = !finished && (
    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
      Edit for this Task
    </Button>
  );
  return (
    <>
      {stages.length > 0 ? (
        <StageTrack
          label={label}
          action={editAction}
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
 * each marker at a known share of the width, so the line, how far it is filled and the loop-backs'
 * arcs need no measuring.
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
  const current = currentStageIndex(stages);
  const scroller = useCurrentStageInView(current, stages.length);
  const reached = Math.max(current, 0);
  const firstMarker = 50 / stages.length;
  const loops = loopBacks(stages);
  const arcHeights = Math.max(0, ...loops.map(({ level }) => level + 1));
  const markerTop =
    arcHeights > 0 ? ARC_ROOM_PX + arcHeights * ARC_ROOM_PER_LEVEL_PX : MARKER_TOP_PX;
  // A Stage edited away since it was selected leaves nothing selected.
  const selected = stages.find(({ stage }) => stage.key === shown?.stageKey);

  const lineTop = markerTop + LINE_FROM_MARKER_TOP_PX;
  const reachedRunning = stages[current]?.state === "running";
  return (
    <section className="pipeline-rail-place" aria-label={label}>
      <div className="pipeline-rail">
        <RailTop
          label={label}
          caption={`${railCaption(stages, task.state)} · select a Stage for its history`}
          action={action}
        />
        <div className="pipeline-rail-scroll" ref={scroller}>
          <div
            className="pipeline-rail-stages"
            style={{
              minWidth: `max(100%, ${stages.length * STAGE_MIN_WIDTH_PX}px)`,
              paddingTop: markerTop,
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
                width: `${(reached * 100) / stages.length}%`,
              }}
            />
            <ol aria-label="Stages">
              {stages.map((taskStage, index) => (
                <RailStage
                  key={taskStage.stage.key}
                  taskStage={taskStage}
                  walkStarted={current >= 0}
                  isCurrent={index === current}
                  isSelected={taskStage === selected}
                  roles={roles}
                  names={names}
                  now={now}
                  onSelect={() => onSelect(taskStage.stage.key)}
                />
              ))}
            </ol>
            {loops.map((loop) => (
              <LoopBackArc
                key={`${loop.from}>${loop.to}`}
                loop={loop}
                stageCount={stages.length}
                markerTop={markerTop}
                names={names}
                onSelect={() => onSelect(loop.from)}
              />
            ))}
            {loopBackEnds(loops, stages.length, markerTop).map((end) => (
              <LoopBackArcEnd key={end.key} end={end} />
            ))}
          </div>
        </div>
        {proposal}
      </div>
      {selected && (
        <StageHistoryWindow
          taskId={task.id}
          stages={stages}
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

/**
 * The line across of a loop-back from the failing Stage to where the work went back, between two
 * `LoopBackArcEnd`s it may share with other loop-backs; its mark selects the failing Stage.
 */
function LoopBackArc({
  loop,
  stageCount,
  markerTop,
  names,
  onSelect,
}: {
  readonly loop: LoopBack;
  readonly stageCount: number;
  readonly markerTop: number;
  readonly names: StageNames;
  readonly onSelect: () => void;
}): ReactNode {
  const { top, landsOn, leaves } = loopBackPath(loop, stageCount, markerTop);
  const words = loopBackWords(loop, names);
  return (
    <div className="pipeline-rail-arc" style={{ top, left: cssOf(landsOn), right: cssOf(leaves) }}>
      <button
        type="button"
        className="pipeline-rail-arc-mark"
        aria-label={words}
        title={words}
        onClick={onSelect}
      >
        ↺ {loop.count} of {loop.rounds}
      </button>
    </div>
  );
}

function LoopBackArcEnd({ end }: { readonly end: LoopBackEnd }): ReactNode {
  const { kind, place, top, height } = end;
  const across = kind === "lands" ? { left: cssOf(place) } : { right: cssOf(place) };
  return (
    <span
      className={`pipeline-rail-arc-end pipeline-rail-arc-${kind}`}
      style={{ top, height, ...across }}
    />
  );
}

function cssOf({ share, offset }: RailPlace): string {
  return `calc(${share}% + ${offset}px)`;
}

function RailStage({
  taskStage,
  walkStarted,
  isCurrent,
  isSelected,
  roles,
  names,
  now,
  onSelect,
}: {
  readonly taskStage: TaskStage;
  readonly walkStarted: boolean;
  readonly isCurrent: boolean;
  readonly isSelected: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
  readonly onSelect: () => void;
}): ReactNode {
  const { stage, state, tokens } = taskStage;
  return (
    <li
      className={`pipeline-rail-stage pipeline-rail-stage-${state} pipeline-rail-stage-kind-${stage.kind}${isSelected ? " pipeline-rail-stage-selected" : ""}`}
    >
      <StageMark taskStage={taskStage} />
      <span className="pipeline-rail-body">
        <span className="pipeline-rail-name">
          {/* Stretched over the column, so what else in it is a control stays one of its own. */}
          <button
            type="button"
            id={stageElementId(stage.key)}
            className="pipeline-rail-button"
            aria-haspopup="dialog"
            aria-current={isCurrent ? "step" : undefined}
            onClick={onSelect}
          >
            {stage.name}
          </button>
          {stage.optional && <span className="pipeline-rail-optional"> · optional</span>}
        </span>
        <span className="pipeline-rail-worker">
          <StageWorker taskStage={taskStage} roles={roles} />
        </span>
        <span className="pipeline-rail-state">
          {state === "running" && <span className="live-dot" />}
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
      </span>
    </li>
  );
}
