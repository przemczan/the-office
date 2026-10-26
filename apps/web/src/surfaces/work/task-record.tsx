import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Role, Stage, Task, TaskStage } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { attachmentQueries, ideaQueries } from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { DefinitionOfDoneBlock, PlanBlock, ProposedPipeline } from "./planning-parts.tsx";
import { RecordBlock } from "./record-block.tsx";
import {
  latestHandoverNote,
  scriptCommandLine,
  stageNamesOf,
  stageProgressLine,
  stageRule,
} from "./stage-words.ts";

/** The Task's record: what must be true, how, its Stages, its Attachments and where it came from. */
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
      <DefinitionOfDoneBlock task={task} planner={planner} />
      <PlanBlock task={task} planner={planner} />
      <StagesBlock task={task} pipeline={pipeline} planner={planner} roles={roles.data} />
      <AttachmentsBlock task={task} />
      {task.originIdeaId !== null && <OriginBlock ideaId={task.originIdeaId} />}
    </section>
  );
}

/**
 * The Task's Stages: its library Pipeline's until it starts, then its own copy with each Stage's
 * runs, refreshed as the walk's events arrive.
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
  const own = useQuery(pipelineQueries.taskStages(task.id)).data?.stages;
  return (
    <RecordBlock icon="route" title={`Stages · ${pipeline?.name ?? task.pipelineId}`}>
      {own ? (
        <TaskStageList taskStages={own} roles={roles} />
      ) : (
        <>
          <ProposedPipeline task={task} pipeline={pipeline} planner={planner} />
          {pipeline ? (
            <StageList stages={pipeline.stages} roles={roles} />
          ) : (
            <p className="task-quiet">The Pipeline {task.pipelineId} isn't in the library.</p>
          )}
        </>
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
  handoverNote,
}: {
  readonly number: number;
  readonly state: TaskStage["state"];
  readonly name: string;
  readonly who: string;
  readonly detail: string;
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
        <div className="task-stage-detail">{detail}</div>
        {handoverNote !== undefined && (
          <div className="task-stage-note">
            <Icon name="sticky-note" size={12} />
            <span>Handover note: {handoverNote}</span>
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

function AttachmentsBlock({ task }: { readonly task: Task }): ReactNode {
  const owner = { kind: "task", taskId: task.id } as const;
  const attachments = useQuery(attachmentQueries.of(owner));
  const [adding, setAdding] = useState(false);
  return (
    <RecordBlock
      icon="paperclip"
      title="Attachments"
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Add
        </Button>
      }
    >
      {attachments.data?.length === 0 ? (
        <p className="task-quiet">None</p>
      ) : (
        <AttachmentChips attachments={attachments.data ?? []} />
      )}
      {adding && (
        <AddAttachmentDialog
          owner={owner}
          ownerTitle={task.title}
          onClose={() => setAdding(false)}
        />
      )}
    </RecordBlock>
  );
}

function OriginBlock({ ideaId }: { readonly ideaId: string }): ReactNode {
  const idea = useQuery(ideaQueries.one(ideaId));
  if (!idea.data) return null;
  return (
    <RecordBlock icon="lightbulb" title="Started from the Idea">
      <p className="task-plan">
        {idea.data.title}{" "}
        <span className="task-quiet">· captured {dayAndClockOf(idea.data.capturedAt)}</span>
      </p>
      {idea.data.notes !== "" && <p className="task-quiet">{idea.data.notes}</p>}
    </RecordBlock>
  );
}
