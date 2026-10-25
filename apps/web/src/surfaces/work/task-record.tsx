import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Role, Stage, Task } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { attachmentQueries, ideaQueries } from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { DefinitionOfDoneBlock, PlanBlock, ProposedPipeline } from "./planning-parts.tsx";
import { RecordBlock } from "./record-block.tsx";

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
      <RecordBlock icon="route" title={`Stages · ${pipeline?.name ?? task.pipelineId}`}>
        <ProposedPipeline task={task} pipeline={pipeline} planner={planner} />
        {pipeline ? (
          <StageList stages={pipeline.stages} roles={roles.data} />
        ) : (
          <p className="task-quiet">The Pipeline {task.pipelineId} isn't in the library.</p>
        )}
      </RecordBlock>
      <AttachmentsBlock task={task} />
      {task.originIdeaId !== null && <OriginBlock ideaId={task.originIdeaId} />}
    </section>
  );
}

/** Each Stage with who works it and how it goes on failure; they run from task 12 on. */
function StageList({
  stages,
  roles,
}: {
  readonly stages: readonly Stage[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  return (
    <ol className="task-stages">
      {stages.map((stage, index) => (
        <li key={stage.key} className="task-stage">
          <span className="task-stage-number">{index + 1}</span>
          <div>
            <div className="task-stage-name">
              <span>{stage.name}</span>{" "}
              <span className="task-stage-who">· {whoWorks(stage, roles)}</span>
            </div>
            <div className="task-stage-detail">{stageDetail(stage, stages)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function whoWorks(stage: Stage, roles: readonly Role[] | undefined): string {
  if (stage.kind === "script") return "script, no Agent";
  if (stage.kind === "gate") return "Gate";
  const role = roles?.find(({ key }) => key === stage.role);
  return role ? `${role.card.name} · ${role.card.title}` : "nobody yet";
}

/** "Pending · optional · on failure back to Implement, at most 3×". */
function stageDetail(stage: Stage, stages: readonly Stage[]): string {
  const onFailure = stage.kind !== "gate" ? stage.onFailure : undefined;
  const target = stages.find(({ key }) => key === onFailure?.goBackTo);
  return [
    "Pending",
    stage.optional && "optional",
    onFailure &&
      `on failure back to ${target?.name ?? onFailure.goBackTo}, at most ${onFailure.rounds}×`,
  ]
    .filter(Boolean)
    .join(" · ");
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
