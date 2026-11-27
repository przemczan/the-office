import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Role, Stage, Task, TaskStage } from "@the-office/contracts";
import { Badge, Button, Dialog } from "@the-office/ui";
import { useMemo, useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { FlowCanvas } from "../../shell/pipelines/flow/flow-canvas.tsx";
import type { FlowStageMark, FlowStageMarks } from "../../shell/pipelines/flow/flow-marks.ts";
import { asFlow } from "../../shell/pipelines/flow/flow-model.ts";
import type { FlowPick } from "../../shell/pipelines/flow/flow-pick.ts";
import { FlowViewport } from "../../shell/pipelines/flow/flow-viewport.tsx";
import { useRouteDrawing } from "../../shell/pipelines/flow/use-route-drawing.ts";
import {
  flowProgressOf,
  pipelineProgress,
  type ProgressStage,
  type StartedOver,
  type WalkStep,
} from "./pipeline-progress.ts";
import { PublishingWait } from "./pipeline-rail.tsx";
import { restartWords, routeFollowedWords, startedOverWords } from "./stage-history-words.ts";
import {
  railCaption,
  railStateWords,
  roundWords,
  stagesOnRail,
  stageWorkerWords,
} from "./stage-rail-words.ts";
import {
  pipelineLabel,
  REMOVED_PIPELINE,
  stageNamesOf,
  STAGE_STATE_WORDS,
  type StageNames,
} from "./stage-words.ts";

const NO_PROBLEMS: readonly never[] = [];

/** The states the legend explains, in the order a Stage goes through them. */
const LEGEND_STATES: readonly TaskStage["state"][] = [
  "done",
  "running",
  "waiting-on-you",
  "failed",
  "pending",
  "not-taken",
];

/**
 * The Task's whole Pipeline as a diagram (docs/design/task-pipeline-progress.html): the editor's
 * canvas read only, in the Route drawing chosen there, with each Stage's state, the routes the work
 * took in heavy ink with their counts, and the routes it didn't dimmed. Beside it, the Stage pressed
 * with the way to its Stage history, and the walk.
 */
export function PipelineDiagramWindow({
  task,
  pipeline,
  onOpenStageHistory,
  onClose,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  /** Closes the diagram and opens the Stage's history. */
  readonly onOpenStageHistory: (stageKey: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const [routeDrawing] = useRouteDrawing();
  const [pickedKey, setPickedKey] = useState<string | undefined>(undefined);
  const stages = useMemo(
    () => stagesOnRail(taskStages?.stages ?? null, pipeline?.stages),
    [taskStages, pipeline],
  );
  const progress = useMemo(() => pipelineProgress(stages, task.state), [stages, task.state]);
  const flow = useMemo(() => stages.map(({ stage }) => stage), [stages]);
  const names = stageNamesOf(flow);
  const marks = useMemo((): FlowStageMarks => {
    const markNames = stageNamesOf(flow);
    const entries = progress.stages.map((entry): [string, FlowStageMark] => [
      entry.taskStage.stage.key,
      {
        tone: entry.taskStage.state,
        label: railStateWords(entry.taskStage, markNames),
        current: entry.taskStage.stage.key === progress.currentKey,
        ...(roundWords(entry) === "" ? {} : { round: roundWords(entry) }),
      },
    ]);
    return new Map(entries);
  }, [progress, flow]);
  const flowProgress = useMemo(() => flowProgressOf(progress), [progress]);
  const flowStages = useMemo(() => asFlow(flow), [flow]);
  const picked = progress.stages.find(({ taskStage }) => taskStage.stage.key === pickedKey);
  // The diagram is read only: pressing a route picks nothing, as no panel tells about a route.
  const pick = (next: FlowPick | undefined): void => {
    if (next === undefined || next.kind === "stage") setPickedKey(next?.key);
  };
  const title = pipelineLabel(
    pipeline?.name ?? REMOVED_PIPELINE,
    taskStages?.editedForTask ?? false,
  );
  return (
    <Dialog
      size="extra-large"
      keepsHeight
      maximizable
      title={`Pipeline diagram: ${title}`}
      unsavedChanges={false}
      onClose={onClose}
    >
      <div className="pipeline-diagram">
        <div className="pipeline-diagram-head">
          <p className="pipeline-diagram-caption">{railCaption(progress, task.state)}</p>
          <PublishingWait task={task} />
          {progress.startedOver && (
            <p className="pipeline-diagram-started-over">
              {startedOverLineWords(progress.startedOver)}
            </p>
          )}
          <Legend />
        </div>
        <div className="pipeline-diagram-body">
          <div className="pipeline-diagram-canvas">
            {/* A window has no page around it, so the frame fills the height, as in full screen. */}
            <FlowViewport fullScreen>
              <FlowCanvas
                stages={flowStages}
                endPosition={taskStages?.endPosition ?? pipeline?.endPosition}
                picked={pickedKey === undefined ? undefined : { kind: "stage", key: pickedKey }}
                onPick={pick}
                problems={NO_PROBLEMS}
                warnings={NO_PROBLEMS}
                whoWorks={(stage) => {
                  const own = stages.find((entry) => entry.stage.key === stage.key);
                  return own ? stageWorkerWords(own, roles) : "";
                }}
                readOnly
                marks={marks}
                progress={flowProgress}
                routeDrawing={routeDrawing}
              />
            </FlowViewport>
          </div>
          <aside className="pipeline-diagram-side" aria-label="Walk">
            {picked && (
              <PickedStage
                picked={picked}
                flow={flow}
                roles={roles}
                names={names}
                onOpenStageHistory={() => onOpenStageHistory(picked.taskStage.stage.key)}
              />
            )}
            <section className="pipeline-diagram-side-block">
              <h3 className="overline">The walk</h3>
              <WalkList
                walk={progress.walk}
                flow={flow}
                names={names}
                pickedKey={pickedKey}
                onPick={setPickedKey}
              />
            </section>
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

/** "Started over by Ann Lee. The earlier start's 6 runs stay in each Stage's history." */
function startedOverLineWords({ by, earlierRuns }: StartedOver): string {
  const runs = earlierRuns === 1 ? "run stays" : `${earlierRuns} runs stay`;
  return `${startedOverWords(by)}. The earlier start's ${runs} in each Stage's history.`;
}

function Legend(): ReactNode {
  return (
    <ul className="pipeline-diagram-legend" aria-label="Legend">
      {LEGEND_STATES.map((state) => (
        <li key={state}>
          <span className={`stage-mark stage-mark-${state}`} aria-hidden="true" />
          {STAGE_STATE_WORDS[state]}
        </li>
      ))}
      <li>
        <span className="pipeline-diagram-legend-taken" aria-hidden="true" />A route taken, with its
        count
      </li>
      <li>
        <span className="pipeline-diagram-legend-not-taken" aria-hidden="true" />A route not taken
      </li>
    </ul>
  );
}

function PickedStage({
  picked,
  flow,
  roles,
  names,
  onOpenStageHistory,
}: {
  readonly picked: ProgressStage;
  readonly flow: readonly Stage[];
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly onOpenStageHistory: () => void;
}): ReactNode {
  const { taskStage, steps } = picked;
  const rounds = roundWords(picked);
  return (
    <section className="pipeline-diagram-side-block pipeline-diagram-picked">
      <h3>{taskStage.stage.name}</h3>
      <p className="pipeline-diagram-worker">{stageWorkerWords(taskStage, roles)}</p>
      <p>
        <Badge>{railStateWords(taskStage, names)}</Badge>
        {rounds !== "" && <span className="pipeline-diagram-rounds"> {rounds}</span>}
      </p>
      {steps.length > 0 && (
        <ol className="pipeline-diagram-walk" aria-label={`Runs of ${taskStage.stage.name}`}>
          {steps.map((step) => (
            <li key={step.run.id}>
              Run {step.run.number}
              <WentWords step={step} flow={flow} names={names} />
            </li>
          ))}
        </ol>
      )}
      <Button size="sm" variant="secondary" onClick={onOpenStageHistory}>
        Open Stage history
      </Button>
    </section>
  );
}

/** Every run of this start, in the order it ran, with where each went; a step picks its Stage. */
function WalkList({
  walk,
  flow,
  names,
  pickedKey,
  onPick,
}: {
  readonly walk: readonly WalkStep[];
  readonly flow: readonly Stage[];
  readonly names: StageNames;
  readonly pickedKey: string | undefined;
  readonly onPick: (stageKey: string) => void;
}): ReactNode {
  if (walk.length === 0) return <p className="task-quiet">The walk starts when the Task starts.</p>;
  return (
    <ol className="pipeline-diagram-walk" aria-label="The walk">
      {walk.map((step) => (
        <li key={step.run.id}>
          <button
            type="button"
            className="pipeline-diagram-step"
            aria-pressed={step.stageKey === pickedKey}
            onClick={() => onPick(step.stageKey)}
          >
            <b>{names(step.stageKey)}</b>
            {step.round > 1 && ` · Round ${step.round}`}
            <WentWords step={step} flow={flow} names={names} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** " · Went back to Implement (1 of at most 3)", as Stage history says it; nothing while it runs. */
function WentWords({
  step: { went, run, stageKey },
  flow,
  names,
}: {
  readonly step: WalkStep;
  readonly flow: readonly Stage[];
  readonly names: StageNames;
}): ReactNode {
  const words =
    went?.kind === "restart"
      ? run.restart && restartWords(run.restart, names)
      : went && run.route && routeFollowedWords(run.route, stageKey, flow, names);
  return words ? <span> · {words}</span> : null;
}
