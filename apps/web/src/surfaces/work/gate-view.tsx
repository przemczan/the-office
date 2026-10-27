import { useQuery } from "@tanstack/react-query";
import type { Attachment, Role, Task, TaskStage, TestResult } from "@the-office/contracts";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentContentUrl, attachmentQueries } from "../../api/work.ts";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { GateActions } from "../../shell/work/gate-actions.tsx";
import { waitingGateOf, type WaitingGate } from "../../shell/work/gate-words.ts";
import { RecordBlock } from "./record-block.tsx";
import { stageNamesOf, stageProgressLine } from "./stage-words.ts";
import { ChangesView } from "./task-changes.tsx";

/**
 * The Gate the Task waits at, inline on its record (spec §4, prototypes/app/now.js): the earlier
 * Stages' results, the Attachments and the Changes, with Continue, Send back and Drop. Nothing
 * while the Task waits at no Gate.
 */
export function GateBlock({
  task,
  roles,
}: {
  readonly task: Task;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const data = useQuery(pipelineQueries.taskStages(task.id)).data;
  const taskStages = data?.stages;
  const waiting = taskStages && waitingGateOf(taskStages);
  if (!data || !taskStages || !waiting) return null;
  return (
    <GateView
      task={task}
      taskStages={taskStages}
      testResults={data.testResults}
      waiting={waiting}
      roles={roles}
    />
  );
}

function GateView({
  task,
  taskStages,
  testResults,
  waiting,
  roles,
}: {
  readonly task: Task;
  readonly taskStages: readonly TaskStage[];
  readonly testResults: readonly TestResult[];
  readonly waiting: WaitingGate;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const changes = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data;
  return (
    <div className="task-gate">
      <RecordBlock icon="hand" title={`Gate · ${waiting.gate.name}`}>
        <p className="task-quiet">
          The Task waits for you to look at the work so far: let it continue, send it back with your
          feedback, or drop it.
        </p>
        <StageResults waiting={waiting} taskStages={taskStages} />
        <GateAttachments task={task} />
        <GateActions task={task} waiting={waiting} roles={roles} />
      </RecordBlock>
      {changes && <ChangesView changes={changes} testResults={testResults} />}
    </div>
  );
}

function StageResults({
  waiting,
  taskStages,
}: {
  readonly waiting: WaitingGate;
  readonly taskStages: readonly TaskStage[];
}): ReactNode {
  const names = stageNamesOf(taskStages.map(({ stage }) => stage));
  return (
    <section className="gate-part" aria-label="Stage results">
      <h4 className="gate-heading">Stage results</h4>
      {waiting.earlier.length === 0 ? (
        <p className="task-quiet">No Stage ran before the Gate.</p>
      ) : (
        <ul className="gate-results">
          {waiting.earlier.map((taskStage) => (
            <li key={taskStage.stage.key}>
              <span className="gate-result-name">{taskStage.stage.name}</span>
              <span className="task-quiet">{stageProgressLine(taskStage, names)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Task's Attachments, where the screenshots an Agent attached for the Gate are. */
function GateAttachments({ task }: { readonly task: Task }): ReactNode {
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId: task.id })).data;
  const images = (attachments ?? []).filter(({ kind }) => kind === "image");
  return (
    <section className="gate-part" aria-label="Gate attachments">
      <h4 className="gate-heading">Attachments</h4>
      {images.length > 0 && <GateScreenshots images={images} />}
      {attachments?.length === 0 ? (
        <p className="task-quiet">None</p>
      ) : (
        <AttachmentChips attachments={attachments ?? []} />
      )}
    </section>
  );
}

/** The image Attachments as thumbnails, each opening the full picture, for a look without the diff. */
function GateScreenshots({ images }: { readonly images: readonly Attachment[] }): ReactNode {
  return (
    <div className="gate-screenshots">
      {images.map((image) => (
        <a
          key={image.id}
          className="gate-screenshot"
          href={attachmentContentUrl(image.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={attachmentContentUrl(image.id)} alt={image.name} loading="lazy" />
        </a>
      ))}
    </div>
  );
}
