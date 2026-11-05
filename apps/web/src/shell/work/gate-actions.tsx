import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role, Stage, Task, TaskStages } from "@the-office/contracts";
import { Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { continueAtGate, pipelineQueries, sendBackFromGate } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { MessageField } from "../conversation/message-field.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { defaultSendBackTarget, sendBackWords, type WaitingGate } from "./gate-words.ts";

export function ContinueRefused({ error }: { readonly error: Error }): ReactNode {
  return <RefusalAlert title="The Task didn't continue" error={error} />;
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
