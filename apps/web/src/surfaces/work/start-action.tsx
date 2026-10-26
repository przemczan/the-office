import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";

/**
 * Start on a Ready Task (prototypes/app/task.js): disabled with the reason while a limit or the
 * Project's Task in progress stands in the way, so the user sees why before clicking.
 */
export function StartButton({ task }: { readonly task: Task }): ReactNode {
  const check = useQuery({ ...taskQueries.startCheck(task.id), enabled: task.state === "ready" });
  const starting = useStarting();
  if (task.state !== "ready") return null;
  const reasons = check.data?.reasons ?? [];
  return (
    <>
      {reasons.length > 0 && (
        <span className="task-head-note">
          <Icon name="lock" size={14} />
          {reasons.join(" ")}
        </span>
      )}
      <Button
        variant="primary"
        iconLeft={<Icon name="play" size={14} />}
        disabled={!check.data || reasons.length > 0}
        loading={starting.isPending}
        onClick={() => starting.mutate(task)}
      >
        Start
      </Button>
    </>
  );
}

function useStarting(): UseMutationResult<Task, Error, Task> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (task: Task) => startTask(task.id),
    onSuccess: (started) => showToast(`${started.title} started.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}
