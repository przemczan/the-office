import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role, Stage, Task, TaskStages } from "@the-office/contracts";
import { Button, Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  continueAtGate,
  dropAtGate,
  pipelineQueries,
  sendBackFromGate,
} from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { MessageField } from "../conversation/message-field.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import "./gate-actions.css";
import { DropTaskDialog } from "./drop-task-dialog.tsx";
import {
  continueLabel,
  defaultSendBackTarget,
  SEND_BACK_WITH_NOTES,
  sendBackWords,
  type WaitingGate,
} from "./gate-words.ts";

/**
 * What the user does at the Gate a Task waits at, on Now and in the Needs you panel: Continue, Send
 * back with notes, or Drop. A Task's own page has the same actions in its Gate's window.
 */
export function GateActions({
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
  const continuing = useContinuingAtGate(task, waiting);
  const busy = continuing.isPending;
  return (
    <>
      <div className="gate-actions">
        <Button
          variant="accent"
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
            {sendingBack ? "Cancel" : SEND_BACK_WITH_NOTES}
          </Button>
        )}
        <Button variant="danger-ghost" disabled={busy} onClick={() => setDropping(true)}>
          Drop
        </Button>
      </div>
      {continuing.error && <ContinueRefused error={continuing.error} />}
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

export function ContinueRefused({ error }: { readonly error: Error }): ReactNode {
  return <RefusalAlert title="The Task didn't continue" error={error} />;
}

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
  const sending = useSendingBack(task, targets, roles, onSent);
  return (
    <form
      className="gate-send-back"
      aria-label="Send back"
      onSubmit={(event) => {
        event.preventDefault();
        sending.send();
      }}
    >
      <SendBackFields sending={sending} />
      <div className="gate-actions">
        <Button
          variant="primary"
          type="submit"
          loading={sending.isPending}
          disabled={!sending.written}
        >
          Send back
        </Button>
      </div>
    </form>
  );
}

/** Send back as it is being written, for its fields and the action that sends it, wherever each sits. */
export interface SendingBack {
  readonly targets: readonly Stage[];
  readonly stageKey: string;
  readonly chooseStage: (stageKey: string) => void;
  readonly feedback: string;
  readonly writeFeedback: (feedback: string) => void;
  readonly words: ReturnType<typeof sendBackWords>;
  /** There is feedback to send. */
  readonly written: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly send: () => void;
}

export function useSendingBack(
  task: Task,
  targets: readonly Stage[],
  roles: readonly Role[] | undefined,
  onSent: () => void,
): SendingBack {
  const [stageKey, chooseStage] = useState(defaultSendBackTarget(targets)?.key ?? "");
  const [feedback, writeFeedback] = useState("");
  const target = targets.find(({ key }) => key === stageKey);
  const words = sendBackWords(target, personOf(target, roles));
  const sending = useGateAction(
    task,
    () => sendBackFromGate(task.id, { stageKey, feedback }),
    words.sent,
  );
  return {
    targets,
    stageKey,
    chooseStage,
    feedback,
    writeFeedback,
    words,
    written: feedback.trim() !== "",
    isPending: sending.isPending,
    error: sending.error,
    send: () => sending.mutate(undefined, { onSuccess: onSent }),
  };
}

/** The earlier Stage to send the work back to, the last Agent Stage by default, and the feedback. */
export function SendBackFields({ sending }: { readonly sending: SendingBack }): ReactNode {
  const { targets, words } = sending;
  return (
    <div className="gate-send-back-fields">
      {targets.length > 1 && (
        <Select
          label="Send back to"
          value={sending.stageKey}
          options={targets.map(({ key, name }) => ({ value: key, label: name }))}
          onChange={sending.chooseStage}
        />
      )}
      {words.scriptNote && <p className="gate-script-note">{words.scriptNote}</p>}
      <MessageField
        label="Your feedback"
        rows={3}
        placeholder={words.placeholder}
        value={sending.feedback}
        onChange={sending.writeFeedback}
        canSend={sending.written && !sending.isPending}
        busyReason={undefined}
        onSend={sending.send}
        autoFocus
      />
      {sending.error && <RefusalAlert title="The work wasn't sent back" error={sending.error} />}
    </div>
  );
}

export function useContinuingAtGate(task: Task, waiting: WaitingGate) {
  return useGateAction(task, () => continueAtGate(task.id), continueToast(waiting));
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
