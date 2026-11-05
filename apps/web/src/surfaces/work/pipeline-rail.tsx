import { useQuery } from "@tanstack/react-query";
import {
  countedTokens,
  type Pipeline,
  type Role,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { TokenFigure } from "../../shell/token-count.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";
import { PipelineProposal } from "./pipeline-proposal.tsx";
import { StageHistory } from "./stage-history.tsx";
import { focusStage, stageElementId } from "./stage-selection.ts";
import { StageWorker } from "./stage-worker.tsx";
import {
  currentStageIndex,
  loopBackPath,
  loopBacks,
  loopBackWords,
  railCaption,
  railRunsWords,
  railScrollLeft,
  railStateWords,
  stagesOnRail,
  type LoopBack,
  type RailPlace,
} from "./stage-rail-words.ts";
import { pipelineLabel, REMOVED_PIPELINE, stageNamesOf, type StageNames } from "./stage-words.ts";

/** How narrow a Stage's column gets; below that the rail scrolls. */
const STAGE_MIN_WIDTH_PX = 150;

/** Where the markers sit in the rail, with no arcs over them. */
const MARKER_TOP_PX = 14;

/** From a marker's top to the top of the line through its centre. */
const LINE_FROM_MARKER_TOP_PX = 11;

/** The room over the markers once there are arcs: what they start from, and what each adds. */
const ARC_ROOM_PX = 26;
const ARC_ROOM_PER_LOOP_PX = 16;

const STATE_ICONS: Readonly<Partial<Record<TaskStage["state"], string>>> = {
  done: "check",
  failed: "x",
  "waiting-on-you": "pause",
  paused: "pause",
  stopped: "square",
  skipped: "minus",
};

/** Where the Task is: every Stage, in order, from its library Pipeline until it has its own copy. */
export function PipelineRail({
  task,
  pipeline,
  selectedKey,
  onSelect,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  /** The Stage whose history is open; the page holds it, as a chapter's link selects too. */
  readonly selectedKey: string | undefined;
  readonly onSelect: (stageKey: string | undefined) => void;
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
          selectedKey={selectedKey}
          onSelect={onSelect}
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
 * The caption, the Stages on their line and the selected Stage's history. Equal columns put each
 * marker at a known share of the width, so the line, how far it is filled and the loop-backs' arcs
 * need no measuring. Selection stays on the page, not in the address: it is a look, not a place.
 * The keys are heard here and not on the document, where the Attachment viewer has its own.
 */
function StageTrack({
  label,
  action,
  proposal,
  stages,
  task,
  roles,
  selectedKey,
  onSelect,
}: {
  readonly label: string;
  readonly action: ReactNode;
  /** The Planner's Pipeline proposal, at the rail's foot. */
  readonly proposal: ReactNode;
  readonly stages: readonly TaskStage[];
  readonly task: Task;
  readonly roles: readonly Role[] | undefined;
  readonly selectedKey: string | undefined;
  readonly onSelect: (stageKey: string | undefined) => void;
}): ReactNode {
  const now = useClock();
  const historyId = useId();
  const names = stageNamesOf(stages.map(({ stage }) => stage));
  const current = currentStageIndex(stages);
  const scroller = useCurrentStageInView(current, stages.length);
  const reached = Math.max(current, 0);
  const firstMarker = 50 / stages.length;
  const loops = loopBacks(stages);
  const markerTop =
    loops.length > 0 ? ARC_ROOM_PX + loops.length * ARC_ROOM_PER_LOOP_PX : MARKER_TOP_PX;
  // A Stage edited away since it was selected leaves nothing selected.
  const selected = stages.findIndex(({ stage }) => stage.key === selectedKey);
  const selectedStage = stages[selected];

  /** Focus follows the selection to the Stage, as what had it may just have gone or been disabled. */
  const select = (key: string | undefined, focusIndex: number): void => {
    onSelect(key);
    const focused = stages[focusIndex];
    if (focused) focusStage(focused.stage.key);
  };
  const toggle = (index: number): void => {
    select(index === selected ? undefined : stages[index]?.stage.key, index);
  };
  const step = (by: -1 | 1): void => {
    const next = stages[selected + by];
    if (next) select(next.stage.key, selected + by);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!selectedStage) return;
    if (event.key === "Escape") select(undefined, selected);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  };

  const lineTop = markerTop + LINE_FROM_MARKER_TOP_PX;
  const reachedRunning = stages[current]?.state === "running";
  return (
    <section className="pipeline-rail-place" aria-label={label} onKeyDown={onKeyDown}>
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
                  isSelected={index === selected}
                  historyId={historyId}
                  roles={roles}
                  names={names}
                  now={now}
                  onToggle={() => toggle(index)}
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
                onSelect={() => {
                  if (loop.fromIndex !== selected) toggle(loop.fromIndex);
                }}
              />
            ))}
          </div>
        </div>
        {proposal}
      </div>
      {selectedStage && (
        <StageHistory
          id={historyId}
          taskId={task.id}
          taskStage={selectedStage}
          noRunsWords={
            NOT_STARTED.includes(task.state) ? "Runs once the Task starts." : "Hasn't run yet."
          }
          isFirst={selected === 0}
          isLast={selected === stages.length - 1}
          roles={roles}
          names={names}
          now={now}
          onStep={step}
          onClose={() => select(undefined, selected)}
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
 * A loop-back from the failing Stage to where the work went back, drawn square by its box's borders
 * so the corners keep their radius at any width; its mark selects the failing Stage.
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
  const path = loopBackPath(loop, stageCount, markerTop);
  const words = loopBackWords(loop, names);
  return (
    <div
      className="pipeline-rail-arc"
      style={{
        top: path.top,
        height: path.height,
        left: cssOf(path.landsOn),
        right: cssOf(path.leaves),
      }}
    >
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

function cssOf({ share, offset }: RailPlace): string {
  return `calc(${share}% + ${offset}px)`;
}

function RailStage({
  taskStage,
  walkStarted,
  isCurrent,
  isSelected,
  historyId,
  roles,
  names,
  now,
  onToggle,
}: {
  readonly taskStage: TaskStage;
  readonly walkStarted: boolean;
  readonly isCurrent: boolean;
  readonly isSelected: boolean;
  readonly historyId: string;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
  readonly onToggle: () => void;
}): ReactNode {
  const { stage, state, tokens } = taskStage;
  const icon = STATE_ICONS[state];
  return (
    <li
      className={`pipeline-rail-stage pipeline-rail-stage-${state} pipeline-rail-stage-kind-${stage.kind}${isSelected ? " pipeline-rail-stage-selected" : ""}`}
    >
      <span className="pipeline-rail-marker">{icon && <Icon name={icon} size={12} />}</span>
      <span className="pipeline-rail-body">
        <span className="pipeline-rail-name">
          {/* Stretched over the column, so what else in it is a control stays one of its own. */}
          <button
            type="button"
            id={stageElementId(stage.key)}
            className="pipeline-rail-button"
            aria-expanded={isSelected}
            aria-controls={isSelected ? historyId : undefined}
            aria-current={isCurrent ? "step" : undefined}
            onClick={onToggle}
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
