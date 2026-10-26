import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Attachment,
  Role,
  Stage,
  Task,
  TaskStage,
  TaskStages,
  TestResult,
} from "@the-office/contracts";
import { Button, Icon, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  continueAtGate,
  dropAtGate,
  pipelineQueries,
  sendBackFromGate,
} from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentContentUrl, attachmentQueries, taskQueries } from "../../api/work.ts";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { DropTaskDialog } from "./drop-task-dialog.tsx";
import {
  continueLabel,
  defaultSendBackTarget,
  sendBackWords,
  waitingGateOf,
  type WaitingGate,
} from "./gate-words.ts";
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

function GateActions({
  task,
  waiting,
  roles,
}: {
  readonly task: Task;
  readonly waiting: WaitingGate;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const [sendingBack, setSendingBack] = useState(false);
  const [dropping, setDropping] = useState(false);
  const continuing = useGateAction(task, () => continueAtGate(task.id), continueToast(waiting));
  const busy = continuing.isPending;
  return (
    <>
      <div className="gate-actions">
        <Button
          variant="primary"
          iconLeft={<Icon name="check" size={14} />}
          loading={continuing.isPending}
          disabled={busy}
          onClick={() => continuing.mutate()}
        >
          {continueLabel(waiting)}
        </Button>
        {waiting.sendBackTargets.length > 0 && (
          <Button
            variant="secondary"
            aria-expanded={sendingBack}
            disabled={busy}
            onClick={() => setSendingBack(!sendingBack)}
          >
            {sendingBack ? "Cancel" : "Send back with notes…"}
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => setDropping(true)}>
          Drop
        </Button>
      </div>
      {continuing.error && (
        <RefusalAlert title="The Task didn't continue" error={continuing.error} />
      )}
      {dropping && (
        <DropTaskDialog
          task={task}
          drop={() => dropAtGate(task.id)}
          onClose={() => setDropping(false)}
        />
      )}
      {sendingBack && (
        <SendBackForm
          task={task}
          targets={waiting.sendBackTargets}
          roles={roles}
          onSent={() => setSendingBack(false)}
        />
      )}
    </>
  );
}

/** The earlier Stage to send the work back to, the last Agent Stage by default, and the feedback. */
function SendBackForm({
  task,
  targets,
  roles,
  onSent,
}: {
  readonly task: Task;
  readonly targets: readonly Stage[];
  readonly roles: readonly Role[] | undefined;
  readonly onSent: () => void;
}): ReactNode {
  const [stageKey, setStageKey] = useState(defaultSendBackTarget(targets)?.key ?? "");
  const [feedback, setFeedback] = useState("");
  const target = targets.find(({ key }) => key === stageKey);
  const words = sendBackWords(target, personOf(target, roles));
  const sending = useGateAction(
    task,
    () => sendBackFromGate(task.id, { stageKey, feedback }),
    words.sent,
  );
  return (
    <form
      className="gate-send-back"
      aria-label="Send back"
      onSubmit={(event) => {
        event.preventDefault();
        sending.mutate(undefined, { onSuccess: onSent });
      }}
    >
      {targets.length > 1 && (
        <Select
          label="Send back to"
          value={stageKey}
          options={targets.map(({ key, name }) => ({ value: key, label: name }))}
          onChange={setStageKey}
        />
      )}
      <Textarea
        aria-label="Your feedback"
        rows={3}
        placeholder={words.placeholder}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className="gate-actions">
        <Button
          variant="primary"
          type="submit"
          loading={sending.isPending}
          disabled={feedback.trim() === ""}
        >
          Send back
        </Button>
      </div>
      {sending.error && <RefusalAlert title="The work wasn't sent back" error={sending.error} />}
    </form>
  );
}

function continueToast({ next }: WaitingGate): string {
  return next ? `Continuing to ${next.name}.` : "Continuing.";
}

function personOf(stage: Stage | undefined, roles: readonly Role[] | undefined): string {
  const role = stage?.kind === "agent" ? roles?.find(({ key }) => key === stage.role) : undefined;
  return role?.card.name ?? "the Agent";
}

/** Sends a Gate action; its answer is the Task's Stages, and the Task's own event moves the Task. */
function useGateAction(task: Task, act: () => Promise<TaskStages>, done: string) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: act,
    onSuccess: (taskStages) => {
      queryClient.setQueryData(pipelineQueries.taskStages(task.id).queryKey, taskStages);
      // A Paused Task keeps the action and goes on from the Gate once resumed.
      showToast(task.state === "paused" ? "Kept: the Task goes on once you resume it." : done);
    },
    onSettled: () => queryClient.invalidateQueries(taskQueries.one(task.id)),
  });
}
