import type { ProjectCommand, Role, TaskStage, TaskState } from "@the-office/contracts";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { whoWorks } from "../../shell/pipelines/pipeline-words.ts";
import { trackLayout, trackStageWords, type TrackLayout } from "./initiative-pipeline-words.ts";
import {
  pipelineProgress,
  type PipelineProgress,
  type ProgressStage,
} from "./pipeline-progress.ts";
import { NowTag, RoundChip } from "./pipeline-rail.tsx";
import { StageMark } from "./stage-mark.tsx";
import { roundWords, stageWaitsForRunEnvironment, stageWorkerWords } from "./stage-rail-words.ts";

/** The room over the marks for the current Stage's "Now" tag, as on the Task page's rail. */
const NOW_ROOM_PX = 26;

/** From a mark's top to the top of the 2px line through its centre. */
const LINE_FROM_MARK_TOP_PX = 11;

/**
 * One Project's track on the Pipelines card, as the Task page's rail orders it: the Stages its
 * Publishing Task reached in the order they first ran, then the rest in Pipeline order, the current
 * one tagged "Now" and a Stage the work came back to once, with its round. Across, on a line green
 * as far as it got, or stacked a Stage a row when its own width can't give each Stage 96px. Before
 * any Publishing Task it is a dashed placeholder with hollow marks and nothing to select; afterwards
 * a Stage selects its history.
 */
export function InitiativePipelineTrack({
  label,
  stages,
  publishingTaskState,
  roles,
  commands,
  selectedKey,
  stageElementId,
  onSelect,
}: {
  /** What the track is, for assistive technology: "<Pipeline> in <Project>". */
  readonly label: string;
  readonly stages: readonly TaskStage[];
  /** The Publishing Task's state; null while no Publishing Task walks these Stages yet. */
  readonly publishingTaskState: TaskState | null;
  readonly roles: readonly Role[] | undefined;
  /** The Project's commands, naming a Script Stage's. */
  readonly commands: readonly Pick<ProjectCommand, "key" | "name">[] | undefined;
  /** The Stage whose history is open. */
  readonly selectedKey: string | undefined;
  readonly stageElementId: (stageKey: string) => string;
  readonly onSelect: (stageKey: string) => void;
}): ReactNode {
  const [measured, layout] = useTrackLayout(stages.length);
  const placeholder = publishingTaskState === null;
  // Before any Publishing Task nothing has run: Pipeline order, as for a Task not started yet.
  const progress = useMemo(
    () => pipelineProgress(stages, publishingTaskState ?? "backlog"),
    [stages, publishingTaskState],
  );
  const who = (taskStage: TaskStage): string => {
    const { stage } = taskStage;
    // Until the Roles are read, an Agent Stage's person isn't known yet.
    if (stage.kind === "agent" && roles === undefined) return "";
    // A duty's Stage is worked by whom the Task's Stages say: its run's Role, or the holder's.
    if (stage.kind === "agent" && stage.duty !== undefined) {
      return stageWorkerWords(taskStage, roles);
    }
    return whoWorks(stage, roles ?? [], commands);
  };
  const shared: TrackParts = {
    progress,
    reach: reachOf(progress),
    placeholder,
    who,
    selectedKey,
    stageElementId,
    onSelect,
  };
  return (
    <div
      ref={measured}
      className={`initiative-track${placeholder ? " initiative-track-placeholder" : ""}`}
      role="group"
      aria-label={label}
      data-layout={layout}
    >
      {layout === "across" ? <AcrossTrack {...shared} /> : <StackedTrack {...shared} />}
    </div>
  );
}

interface TrackParts {
  readonly progress: PipelineProgress;
  readonly reach: Reach;
  readonly placeholder: boolean;
  readonly who: (taskStage: TaskStage) => string;
  readonly selectedKey: string | undefined;
  readonly stageElementId: (stageKey: string) => string;
  readonly onSelect: (stageKey: string) => void;
}

/** How many Stages the line is green through, and whether the last of them runs, fading it to blue. */
interface Reach {
  readonly count: number;
  readonly live: boolean;
}

function reachOf({ stages, currentKey }: PipelineProgress): Reach {
  const count = stages.filter(({ reached }) => reached).length;
  const last = stages[count - 1]?.taskStage;
  return { count, live: last?.stage.key === currentKey && last?.state === "running" };
}

/**
 * The track's own width decides its layout, measured before it is painted and again as it changes.
 * With no `ResizeObserver` (a test's DOM) it stays across.
 */
function useTrackLayout(stageCount: number): [RefObject<HTMLDivElement | null>, TrackLayout] {
  const element = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<TrackLayout>("across");
  useLayoutEffect(() => {
    const track = element.current;
    if (track === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => setLayout(trackLayout(track.clientWidth, stageCount));
    measure();
    const resizing = new ResizeObserver(measure);
    resizing.observe(track);
    return () => resizing.disconnect();
  }, [stageCount]);
  return [element, layout];
}

function AcrossTrack(parts: TrackParts): ReactNode {
  const { progress, reach } = parts;
  const count = progress.stages.length;
  const firstMark = 50 / count;
  const markTop = progress.currentKey === null ? 0 : NOW_ROOM_PX;
  const lineTop = markTop + LINE_FROM_MARK_TOP_PX;
  return (
    <div className="initiative-track-across" style={{ paddingTop: markTop }}>
      <span
        className="initiative-track-line"
        style={{ top: lineTop, left: `${firstMark}%`, right: `${firstMark}%` }}
      />
      {reach.count > 1 && (
        <span
          className={`initiative-track-reached${reach.live ? " initiative-track-reached-live" : ""}`}
          style={{
            top: lineTop,
            left: `${firstMark}%`,
            width: `${((reach.count - 1) * 100) / count}%`,
          }}
        />
      )}
      <ol
        className="initiative-track-cells"
        aria-label="Stages"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {progress.stages.map((progressStage) => {
          const { taskStage } = progressStage;
          const isCurrent = taskStage.stage.key === progress.currentKey;
          return (
            <li key={taskStage.stage.key} className={stageClass(taskStage, parts)}>
              <StageBody taskStage={taskStage} isCurrent={isCurrent} parts={parts}>
                {isCurrent && <NowTag state={taskStage.state} />}
                <StageMark taskStage={taskStage} />
                <span className="initiative-track-name">{taskStage.stage.name}</span>
                <StageWords taskStage={taskStage} parts={parts} />
                <RoundChip progressStage={progressStage} />
              </StageBody>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A Stage a row down a line through the marks, green as far as it got; its round in its name. */
function StackedTrack(parts: TrackParts): ReactNode {
  const { progress, reach } = parts;
  const last = progress.stages.length - 1;
  return (
    <ol className="initiative-track-rows" aria-label="Stages">
      {progress.stages.map((progressStage, index) => {
        const { taskStage } = progressStage;
        const isCurrent = taskStage.stage.key === progress.currentKey;
        const reached = [
          index === 0 && "initiative-track-first",
          index === last && "initiative-track-last",
          index > 0 && index < reach.count && "initiative-track-reached-above",
          index > 0 && index === reach.count - 1 && reach.live && "initiative-track-reached-live",
          index < reach.count - 1 && "initiative-track-reached-below",
        ].filter((name) => typeof name === "string");
        return (
          <li
            key={taskStage.stage.key}
            className={[stageClass(taskStage, parts), "initiative-track-row", ...reached].join(" ")}
          >
            <StageBody taskStage={taskStage} isCurrent={isCurrent} parts={parts}>
              <StageMark taskStage={taskStage} />
              <span className="initiative-track-row-text">
                <span className="initiative-track-name">{stackedNameWords(progressStage)}</span>
                {isCurrent && <NowTag state={taskStage.state} />}
                <StageWords taskStage={taskStage} parts={parts} />
              </span>
            </StageBody>
          </li>
        );
      })}
    </ol>
  );
}

/** A stacked row's name with its round: "Implement · Round 3 of at most 4". */
function stackedNameWords(progressStage: ProgressStage): string {
  const { name } = progressStage.taskStage.stage;
  const round = roundWords(progressStage, true);
  return round === "" ? name : `${name} · ${round}`;
}

function stageClass({ stage, state }: TaskStage, { selectedKey }: TrackParts): string {
  const selected = stage.key === selectedKey ? " initiative-track-stage-selected" : "";
  return `initiative-track-stage initiative-track-stage-${state}${selected}`;
}

/** A Stage's mark and words: a button opening its history, or, on the placeholder, nothing to press. */
function StageBody({
  taskStage,
  isCurrent,
  parts: { placeholder, stageElementId, onSelect },
  children,
}: {
  readonly taskStage: TaskStage;
  readonly isCurrent: boolean;
  readonly parts: TrackParts;
  readonly children: ReactNode;
}): ReactNode {
  if (placeholder) return <span className="initiative-track-body">{children}</span>;
  return (
    <button
      type="button"
      id={stageElementId(taskStage.stage.key)}
      className="initiative-track-body"
      aria-haspopup="dialog"
      aria-current={isCurrent ? "step" : undefined}
      onClick={() => onSelect(taskStage.stage.key)}
    >
      {children}
    </button>
  );
}

function StageWords({
  taskStage,
  parts: { who },
}: {
  readonly taskStage: TaskStage;
  readonly parts: TrackParts;
}): ReactNode {
  const live = taskStage.state === "running" && !stageWaitsForRunEnvironment(taskStage);
  return (
    <span className="initiative-track-words">
      {live && <span className="live-dot" />}
      {trackStageWords(taskStage, who(taskStage))}
    </span>
  );
}
