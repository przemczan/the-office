import { useQuery } from "@tanstack/react-query";
import type { Role, Task, TaskStage, TestResult } from "@the-office/contracts";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries } from "../../api/work.ts";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import { attachmentRounds, oneRound } from "../../shell/attachments/attachment-rounds.ts";
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
          Look at the work so far, then Continue, Send back with notes, or Drop.
        </p>
        <StageResults waiting={waiting} taskStages={taskStages} />
        <GateAttachments task={task} taskStages={taskStages} />
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

/**
 * The current round's Attachments, where the screenshots an Agent attached for the Gate are; the
 * earlier rounds stay on the Task's record.
 */
function GateAttachments({
  task,
  taskStages,
}: {
  readonly task: Task;
  readonly taskStages: readonly TaskStage[];
}): ReactNode {
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId: task.id })).data;
  const current = attachmentRounds(attachments ?? [], taskStages).at(-1)?.attachments ?? [];
  return (
    <section className="gate-part" aria-label="Gate attachments">
      <h4 className="gate-heading">Attachments</h4>
      {attachments && current.length === 0 ? (
        <p className="task-quiet">None in this round</p>
      ) : (
        <AttachmentGallery rounds={oneRound(current)} />
      )}
    </section>
  );
}
