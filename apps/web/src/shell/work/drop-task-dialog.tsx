import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { dropTask, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";

/** Dropping is the Task's exit: it can't come back. */
export function DropTaskDialog({
  task,
  onClose,
}: {
  readonly task: Task;
  readonly onClose: () => void;
}): ReactNode {
  const dropping = useDroppingTask(() => dropTask(task.id), onClose);
  return (
    <Dialog
      size="small"
      title={`Drop ${task.title}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={dropping.isPending} onClick={() => dropping.mutate()}>
          Drop the Task
        </Button>
      }
    >
      <div className="dialog-stack">
        <WhatDroppingDoes error={dropping.error} />
      </div>
    </Dialog>
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
        It moves to Done as dropped and stays readable there; a dropped Task can't be picked up
        again.
      </p>
    </>
  );
}
