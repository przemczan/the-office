import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskSummary } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dropTask, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import {
  DropReasonField,
  dropReasonOf,
  NO_DROP_REASON,
  type DropReasonDraft,
} from "./drop-reason-field.tsx";

/**
 * Dropping is the Task's exit, until Reopen… brings it back. A small window still, with the optional reason:
 * picking one is unsaved input.
 */
export function DropTaskDialog({
  task,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly onClose: () => void;
}): ReactNode {
  const [reason, setReason] = useState<DropReasonDraft>(NO_DROP_REASON);
  const sent = dropReasonOf(reason);
  const dropping = useDroppingTask(
    () => dropTask(task.id, "reason" in sent ? sent.reason : undefined),
    onClose,
  );
  return (
    <Dialog
      size="small"
      title={`Drop ${task.title}?`}
      unsavedChanges={reason.kind !== ""}
      onClose={onClose}
      actions={<DropButton label="Drop the Task" sent={sent} dropping={dropping} />}
    >
      <div className="dialog-stack">
        <WhatDroppingDoes error={dropping.error} />
        <DropReasonField task={task} draft={reason} onChange={setReason} />
      </div>
    </Dialog>
  );
}

/** Drop's button, disabled while the reason picked lacks what it needs, saying so on hover. */
export function DropButton({
  label,
  sent,
  dropping,
}: {
  readonly label: string;
  readonly sent: ReturnType<typeof dropReasonOf>;
  readonly dropping: ReturnType<typeof useDroppingTask>;
}): ReactNode {
  const missing = "missing" in sent ? sent.missing : undefined;
  return (
    <Button
      variant="danger"
      loading={dropping.isPending}
      disabled={missing !== undefined}
      title={missing}
      onClick={() => dropping.mutate()}
    >
      {label}
    </Button>
  );
}

/** `drop` is how: the Task's own Drop, or the one at a Gate. */
export function useDroppingTask(drop: () => Promise<unknown>, onDropped: () => void) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: drop,
    onSuccess: async () => {
      await queryClient.invalidateQueries(taskQueries.list());
      showToast("Task dropped.");
      onDropped();
    },
  });
}

export function WhatDroppingDoes({ error }: { readonly error: Error | null }): ReactNode {
  return (
    <>
      {error && <RefusalAlert title="The Task can't be dropped" error={error} />}
      <p className="dialog-text">
        It moves to Done as dropped and stays readable there; Reopen… brings it back to Backlog or
        Ready.
      </p>
    </>
  );
}
