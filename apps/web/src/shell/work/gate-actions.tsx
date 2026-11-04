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
  sendBackWords,
  type WaitingGate,
} from "./gate-words.ts";

/**
 * What the user does at the Gate a Task waits at: Continue, Send back with notes, or Drop. The same
 * in the Task's Needs you card, on Now and in the Needs you panel.
 */
/** Bordered as the buttons beside it, in the colour of what can't be undone. */
const DROP_LOOK = { color: "var(--danger-fg)" } as const;

export function GateActions({
  task,
  waiting,
  roles,
  alongside,
}: {
  readonly task: Task;
  readonly waiting: WaitingGate;
  readonly roles: readonly Role[] | undefined;
  /** Another way on from the Gate, in the same row. */
  readonly alongside?: ReactNode;
}): ReactNode {
  const [sendingBack, setSendingBack] = useState(false);
  const [dropping, setDropping] = useState(false);
  const continuing = useGateAction(task, () => continueAtGate(task.id), continueToast(waiting));
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
        {alongside}
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
        <Button
          variant="secondary"
          style={DROP_LOOK}
          disabled={busy}
          onClick={() => setDropping(true)}
        >
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
  const canSend = !sending.isPending && feedback.trim() !== "";
  const send = (): void => sending.mutate(undefined, { onSuccess: onSent });
  return (
    <form
      className="gate-send-back"
      aria-label="Send back"
      onSubmit={(event) => {
        event.preventDefault();
        send();
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
      {words.scriptNote && <p className="gate-script-note">{words.scriptNote}</p>}
      <MessageField
        label="Your feedback"
        rows={3}
        placeholder={words.placeholder}
        value={feedback}
        onChange={setFeedback}
        canSend={canSend}
        busyReason={undefined}
        onSend={send}
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
