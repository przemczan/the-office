import type { ProjectCommand, Role, TaskStage } from "@the-office/contracts";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { whoWorks } from "../../shell/pipelines/pipeline-words.ts";
import {
  stackedLoopBackWords,
  trackLayout,
  trackStageWords,
  type TrackLayout,
} from "./initiative-pipeline-words.ts";
import { StageMark } from "./stage-mark.tsx";
import {
  currentStageIndex,
  loopBackEnds,
  loopBackPath,
  loopBacks,
  loopBackWords,
  stageWaitsForRunEnvironment,
  stageWorkerWords,
  type LoopBack,
  type RailPlace,
} from "./stage-rail-words.ts";
import { stageNamesOf, type StageNames } from "./stage-words.ts";

/** From a mark's top to the top of the 2px line through its centre. */
const LINE_FROM_MARK_TOP_PX = 11;

/** The room over the marks once there are loop-backs, as on the Task page's rail. */
const ARC_ROOM_PX = 26;
const ARC_ROOM_PER_LEVEL_PX = 16;

/**
 * One Project's track on the Pipelines card: its Stages across, with the Task page's marks on a
 * line green as far as its Publishing Task got, or stacked a Stage a row when its own width can't
 * give each Stage 96px. Before any Publishing Task it is a dashed placeholder with hollow marks and
 * nothing to select; afterwards a Stage selects its history.
 */
export function InitiativePipelineTrack({
  label,
  stages,
  placeholder,
  roles,
  commands,
  selectedKey,
  stageElementId,
  onSelect,
}: {
  /** What the track is, for assistive technology: "<Pipeline> in <Project>". */
  readonly label: string;
  readonly stages: readonly TaskStage[];
  /** No Publishing Task walks these Stages yet. */
  readonly placeholder: boolean;
  readonly roles: readonly Role[] | undefined;
  /** The Project's commands, naming a Script Stage's. */
  readonly commands: readonly Pick<ProjectCommand, "key" | "name">[] | undefined;
  /** The Stage whose history is open. */
  readonly selectedKey: string | undefined;
  readonly stageElementId: (stageKey: string) => string;
  readonly onSelect: (stageKey: string) => void;
}): ReactNode {
  const [measured, layout] = useTrackLayout(stages.length);
  const names = stageNamesOf(stages.map(({ stage }) => stage));
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
    stages,
    placeholder,
    names,
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
  readonly stages: readonly TaskStage[];
  readonly placeholder: boolean;
  readonly names: StageNames;
  readonly who: (taskStage: TaskStage) => string;
  readonly selectedKey: string | undefined;
  readonly stageElementId: (stageKey: string) => string;
  readonly onSelect: (stageKey: string) => void;
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

/** How far the line is green, and whether the Stage it reached runs, fading it to blue. */
function reachOf(stages: readonly TaskStage[], placeholder: boolean): [number, boolean] {
  if (placeholder) return [-1, false];
  const current = currentStageIndex(stages);
  return [current, stages[current]?.state === "running"];
}

function AcrossTrack(parts: TrackParts): ReactNode {
  const { stages, placeholder, names, onSelect } = parts;
  const count = stages.length;
  const [current, live] = reachOf(stages, placeholder);
  const reached = Math.max(current, 0);
  const firstMark = 50 / count;
  const loops = placeholder ? [] : loopBacks(stages);
  const levels = Math.max(0, ...loops.map(({ level }) => level + 1));
  const markTop = levels > 0 ? ARC_ROOM_PX + levels * ARC_ROOM_PER_LEVEL_PX : 0;
  const lineTop = markTop + LINE_FROM_MARK_TOP_PX;
  return (
    <div className="initiative-track-across" style={{ paddingTop: markTop }}>
      <span
        className="initiative-track-line"
        style={{ top: lineTop, left: `${firstMark}%`, right: `${firstMark}%` }}
      />
      {reached > 0 && (
        <span
          className={`initiative-track-reached${live ? " initiative-track-reached-live" : ""}`}
          style={{ top: lineTop, left: `${firstMark}%`, width: `${(reached * 100) / count}%` }}
        />
      )}
      <ol
        className="initiative-track-cells"
        aria-label="Stages"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {stages.map((taskStage, index) => (
          <li key={taskStage.stage.key} className={stageClass(taskStage, parts)}>
            <StageBody taskStage={taskStage} isCurrent={index === current} parts={parts}>
              <StageMark taskStage={taskStage} />
              <span className="initiative-track-name">{taskStage.stage.name}</span>
              <StageWords taskStage={taskStage} parts={parts} />
            </StageBody>
          </li>
        ))}
      </ol>
      {loops.map((loop) => (
        <LoopBackArc
          key={`${loop.from}>${loop.to}`}
          loop={loop}
          stageCount={count}
          markTop={markTop}
          names={names}
          onSelect={() => onSelect(loop.from)}
        />
      ))}
      {loopBackEnds(loops, count, markTop).map(({ key, kind, place, top, height }) => (
        <span
          key={key}
          className={`pipeline-rail-arc-end pipeline-rail-arc-${kind}`}
          style={{
            top,
            height,
            ...(kind === "lands" ? { left: cssOf(place) } : { right: cssOf(place) }),
          }}
        />
      ))}
    </div>
  );
}

/** A Stage a row down a line through the marks, green as far as it got; loop-backs in words under it. */
function StackedTrack(parts: TrackParts): ReactNode {
  const { stages, placeholder, names, onSelect } = parts;
  const [current, live] = reachOf(stages, placeholder);
  const loops = placeholder ? [] : loopBacks(stages);
  return (
    <>
      <ol className="initiative-track-rows" aria-label="Stages">
        {stages.map((taskStage, index) => {
          const reach = [
            index === 0 && "initiative-track-first",
            index === stages.length - 1 && "initiative-track-last",
            index > 0 && index <= current && "initiative-track-reached-above",
            index > 0 && index === current && live && "initiative-track-reached-live",
            index < current && "initiative-track-reached-below",
          ].filter((name) => typeof name === "string");
          return (
            <li
              key={taskStage.stage.key}
              className={[stageClass(taskStage, parts), "initiative-track-row", ...reach].join(" ")}
            >
              <StageBody taskStage={taskStage} isCurrent={index === current} parts={parts}>
                <StageMark taskStage={taskStage} />
                <span className="initiative-track-row-text">
                  <span className="initiative-track-name">{taskStage.stage.name}</span>
                  <StageWords taskStage={taskStage} parts={parts} />
                </span>
              </StageBody>
            </li>
          );
        })}
      </ol>
      {loops.map((loop) => (
        <button
          key={`${loop.from}>${loop.to}`}
          type="button"
          className="initiative-track-loop-words"
          aria-haspopup="dialog"
          onClick={() => onSelect(loop.from)}
        >
          ↺ {stackedLoopBackWords(loop, names)}
        </button>
      ))}
    </>
  );
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

/** A loop-back's line across, square over the marks, with "↺ 1 of 2", which opens the failing Stage. */
function LoopBackArc({
  loop,
  stageCount,
  markTop,
  names,
  onSelect,
}: {
  readonly loop: LoopBack;
  readonly stageCount: number;
  readonly markTop: number;
  readonly names: StageNames;
  readonly onSelect: () => void;
}): ReactNode {
  const { top, landsOn, leaves } = loopBackPath(loop, stageCount, markTop);
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
        ↺ {loop.count}
        {loop.rounds !== null && ` of ${loop.rounds}`}
      </button>
    </div>
  );
}

function cssOf({ share, offset }: RailPlace): string {
  return `calc(${share}% + ${offset}px)`;
}
