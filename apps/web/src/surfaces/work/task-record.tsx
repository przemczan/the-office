import { useQuery } from "@tanstack/react-query";
import {
  countedTokens,
  type Pipeline,
  type Role,
  type Stage,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { DependenciesBlock } from "./dependencies-block.tsx";
import { GateBlock } from "./gate-view.tsx";
import { DefinitionOfDoneBlock, PlanBlock, ProposedPipeline } from "./planning-parts.tsx";
import { OriginBlock } from "./origin-block.tsx";
import { ReadyBlock } from "./ready-block.tsx";
import { RecordBlock } from "./record-block.tsx";
import {
  latestHandoverNote,
  pipelineLabel,
  REMOVED_PIPELINE,
  scriptCommandLine,
  stageNamesOf,
  stageProgressLine,
  stageRule,
} from "./stage-words.ts";
import { TokenInfo } from "../../shell/token-count.tsx";

/**
 * The Task's Overview: the Gate it waits at, if any; what must be true, how, its Stages, its
 * dependencies and where it came from.
 */
export function TaskRecord({
  task,
  pipeline,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const roles = useQuery(roleQueries.list());
  // It starts a sentence here.
  const planner = usePlanner()?.card.name ?? "The Planner";
  return (
    <section className="task-record" aria-label="Record">
      <GateBlock task={task} roles={roles.data} />
      <ReadyBlock task={task} />
      <DefinitionOfDoneBlock task={task} planner={planner} />
      <PlanBlock task={task} planner={planner} />
      <StagesBlock task={task} pipeline={pipeline} planner={planner} roles={roles.data} />
      <DependenciesBlock task={task} />
      <OriginBlock
        record={{ kind: "task", id: task.id }}
        ideaId={task.originIdeaId}
        initiativeId={task.initiativeId}
      />
    </section>
  );
}

/**
 * The Task's Stages: its library Pipeline's until it has its own copy, made as it starts or as the
 * user edits them for the Task, then that copy with each Stage's runs, refreshed as the walk's
 * events arrive. The Planner's proposal shows until the Task starts.
 */
function StagesBlock({
  task,
  pipeline,
  planner,
  roles,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  readonly planner: string;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const own = taskStages?.stages;
  const proposing = NOT_STARTED.includes(task.state) && task.proposedPipeline !== null;
  if (!own && !pipeline && !proposing) return null;
  return (
    <RecordBlock
      icon="route"
      title={`Stages · ${pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, taskStages?.editedForTask ?? false)}`}
    >
      {proposing && <ProposedPipeline task={task} pipeline={pipeline} planner={planner} />}
      {own ? (
        <TaskStageList taskStages={own} roles={roles} />
      ) : (
        pipeline && <StageList stages={pipeline.stages} roles={roles} />
      )}
    </RecordBlock>
  );
}

/** The library Pipeline's Stages, with who works each and how it goes on failure. */
function StageList({
  stages,
  roles,
}: {
  readonly stages: readonly Stage[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const names = stageNamesOf(stages);
  return (
    <ol className="task-stages">
      {stages.map((stage, index) => (
        <StageRow
          key={stage.key}
          number={index + 1}
          state="pending"
          name={stage.name}
          who={whoWorks(stage, roles, undefined)}
          detail={["Pending", ...stageRule(stage, names)].join(" · ")}
          handoverNote={undefined}
        />
      ))}
    </ol>
  );
}

/** A started Task's own Stages, each with its state, time, tokens, session and Handover note. */
function TaskStageList({
  taskStages,
  roles,
}: {
  readonly taskStages: readonly TaskStage[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const names = stageNamesOf(taskStages.map(({ stage }) => stage));
  return (
    <ol className="task-stages">
      {taskStages.map((taskStage, index) => (
        <StageRow
          key={taskStage.stage.key}
          number={index + 1}
          state={taskStage.state}
          name={taskStage.stage.name}
          who={whoWorks(taskStage.stage, roles, scriptCommandLine(taskStage))}
          detail={stageProgressLine(taskStage, names)}
          tokens={taskStage.tokens}
          handoverNote={latestHandoverNote(taskStage)}
        />
      ))}
    </ol>
  );
}

function StageRow({
  number,
  state,
  name,
  who,
  detail,
  tokens,
  handoverNote,
}: {
  readonly number: number;
  readonly state: TaskStage["state"];
  readonly name: string;
  readonly who: string;
  readonly detail: string;
  /** Its runs' tokens, which `detail` counts; undefined before the Stage runs. */
  readonly tokens?: TaskStage["tokens"];
  readonly handoverNote: string | undefined;
}): ReactNode {
  return (
    <li className={`task-stage task-stage-${state}`}>
      <span className="task-stage-number">
        {state === "done" ? <Icon name="check" size={12} /> : number}
      </span>
      <div>
        <div className="task-stage-name">
          <span>{name}</span> <span className="task-stage-who">· {who}</span>
        </div>
        <div className="task-stage-detail">
          <MarkdownText text={detail} inline />
          {tokens && countedTokens(tokens) > 0 && <TokenInfo tokens={tokens} />}
        </div>
        {handoverNote !== undefined && (
          <div className="task-stage-note">
            <Icon name="sticky-note" size={12} />
            <div>
              <div className="task-stage-note-label">Handover note</div>
              <MarkdownText text={handoverNote} />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** The person for an Agent Stage; for a Script Stage, its command once it has run it. */
function whoWorks(
  stage: Stage,
  roles: readonly Role[] | undefined,
  commandLine: string | undefined,
): string {
  if (stage.kind === "script") {
    return commandLine === undefined ? "script, no Agent" : `script ${commandLine}, no Agent`;
  }
  if (stage.kind === "gate") return "Gate";
  const role = roles?.find(({ key }) => key === stage.role);
  return role ? `${role.card.name} · ${role.card.title}` : "nobody yet";
}
