import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { dropTask, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";

/**
 * Dropping is the Task's exit: it can't come back. `drop` is how, such as at a Gate; by default
 * the Task's own Drop.
 */
export function DropTaskDialog({
  task,
  drop = () => dropTask(task.id),
  onClose,
}: {
  readonly task: Task;
  readonly drop?: () => Promise<unknown>;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const dropping = useMutation({
    mutationFn: drop,
    onSuccess: async () => {
      await queryClient.invalidateQueries(taskQueries.list());
      showToast("Task dropped.");
      onClose();
    },
  });
  return (
    <Dialog
      title={`Drop ${task.title}?`}
      tone="danger"
      width={480}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={dropping.isPending} onClick={() => dropping.mutate()}>
            Drop the Task
          </Button>
        </>
      }
    >
      {dropping.error && <RefusalAlert title="The Task can't be dropped" error={dropping.error} />}
      <p className="dialog-text">
        It moves to Done as dropped and stays readable there; a dropped Task can't be picked up
        again.
      </p>
    </Dialog>
  );
}
