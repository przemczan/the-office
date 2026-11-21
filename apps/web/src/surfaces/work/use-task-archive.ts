import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Task, TaskSummary } from "@the-office/contracts";
import { archiveTask, restoreTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";

/** Archive, with no confirmation since Restore undoes it: a toast names the Task. */
export function useArchiving(): UseMutationResult<Task, Error, TaskSummary> {
  return useArchiveChange(archiveTask, (task) => `${task.title} is archived.`);
}

/** Restore, in one click: the Task is back on the board in the state it had. */
export function useRestoring(): UseMutationResult<Task, Error, TaskSummary> {
  return useArchiveChange(restoreTask, (task) => `${task.title} is back on the board.`);
}

function useArchiveChange(
  change: (id: string) => Promise<Task>,
  words: (changed: Task) => string,
): UseMutationResult<Task, Error, TaskSummary> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (task: TaskSummary) => change(task.id),
    onSuccess: (changed) => showToast(words(changed)),
    onError: (error) => showToast(error.message),
    // ["tasks"] covers the list and each Task's page.
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}
