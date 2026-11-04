import { useQuery } from "@tanstack/react-query";
import {
  countedTokens,
  type Pipeline,
  type Role,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { TokenCount } from "../../shell/token-count.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { EditTaskStagesDialog } from "./edit-task-stages-dialog.tsx";
import { RecordBlock } from "./record-block.tsx";
import {
  currentStageIndex,
  railCaption,
  railRunsWords,
  railStateWords,
  stagesOnRail,
  stageWorkerWords,
} from "./stage-rail-words.ts";
import { pipelineLabel, REMOVED_PIPELINE, stageNamesOf, type StageNames } from "./stage-words.ts";

/** How narrow a Stage's column gets; below that the rail scrolls. */
const STAGE_MIN_WIDTH_PX = 150;

const STATE_ICONS: Readonly<Partial<Record<TaskStage["state"], string>>> = {
  done: "check",
  failed: "x",
  "waiting-on-you": "hand",
  paused: "pause",
  stopped: "square",
  skipped: "minus",
};

/** Where the Task is: every Stage, in order, from its library Pipeline until it has its own copy. */
export function PipelineRail({
  task,
  pipeline,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const [editing, setEditing] = useState(false);
  // Until the Task's Stages are read, the library's would show a started Task as not started.
  if (!taskStages) return null;
  const stages = stagesOnRail(taskStages.stages, pipeline?.stages);
  const finished = task.state === "done" || task.state === "dropped";
  return (
    <RecordBlock
      icon="route"
      title={`Pipeline · ${pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, taskStages.editedForTask)}`}
      actions={
        !finished && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit for this Task
          </Button>
        )
      }
    >
      {stages.length > 0 ? (
        <StageTrack stages={stages} task={task} roles={roles} />
      ) : (
        <p className="task-quiet">Its Pipeline was removed from the library.</p>
      )}
      {editing && <EditTaskStagesDialog task={task} onClose={() => setEditing(false)} />}
    </RecordBlock>
  );
}

/**
 * The caption and the Stages on their line. Equal columns put each marker at a known share of the
 * width, so the line and how far it is filled need no measuring.
 */
function StageTrack({
  stages,
  task,
  roles,
}: {
  readonly stages: readonly TaskStage[];
  readonly task: Task;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const now = useClock();
  const names = stageNamesOf(stages.map(({ stage }) => stage));
  const current = currentStageIndex(stages);
  const reached = Math.max(current, 0);
  const firstMarker = 50 / stages.length;
  return (
    <>
      <p className="pipeline-rail-caption">{railCaption(stages, task.state)}</p>
      <div className="pipeline-rail-scroll">
        <div
          className="pipeline-rail-stages"
          style={{ minWidth: `max(100%, ${stages.length * STAGE_MIN_WIDTH_PX}px)` }}
        >
          <span
            className="pipeline-rail-line"
            style={{ left: `${firstMarker}%`, right: `${firstMarker}%` }}
          />
          <span
            className="pipeline-rail-reached"
            style={{ left: `${firstMarker}%`, width: `${(reached * 100) / stages.length}%` }}
          />
          <ol aria-label="Stages">
            {stages.map((taskStage, index) => (
              <RailStage
                key={taskStage.stage.key}
                taskStage={taskStage}
                number={index + 1}
                walkStarted={current >= 0}
                roles={roles}
                names={names}
                now={now}
              />
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

function RailStage({
  taskStage,
  number,
  walkStarted,
  roles,
  names,
  now,
}: {
  readonly taskStage: TaskStage;
  readonly number: number;
  readonly walkStarted: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly names: StageNames;
  readonly now: Date;
}): ReactNode {
  const { stage, state, tokens } = taskStage;
  const icon = STATE_ICONS[state];
  const worker = stageWorkerWords(taskStage, roles);
  return (
    <li className={`pipeline-rail-stage pipeline-rail-stage-${state}`}>
      <span className="pipeline-rail-marker">{icon ? <Icon name={icon} size={12} /> : number}</span>
      <span className="pipeline-rail-name">
        {stage.name}
        {stage.optional && <span className="pipeline-rail-optional"> · optional</span>}
      </span>
      <span className="pipeline-rail-worker" title={worker}>
        {worker}
      </span>
      <span className="pipeline-rail-state">{railStateWords(taskStage, names)}</span>
      <span className="pipeline-rail-runs">
        {railRunsWords(taskStage, walkStarted, now)}
        {countedTokens(tokens) > 0 && (
          <>
            {" · "}
            <TokenCount tokens={tokens} label="tokens" />
          </>
        )}
      </span>
    </li>
  );
}
