import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Idea, Task } from "@the-office/contracts";
import { ideaQueries, shapeIdea, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";

/** Shapes the Idea into a Task in a Project, given by its id; the Task starts in Backlog. */
export function useShaping(idea: Idea): UseMutationResult<Task, Error, string> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (projectId: string) => shapeIdea(idea.id, projectId),
    onSuccess: (task) => showToast(`${task.title} is a Task in Backlog.`),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(ideaQueries.list()),
        queryClient.invalidateQueries(taskQueries.list()),
      ]),
  });
}
