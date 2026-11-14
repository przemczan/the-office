import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Idea, Task } from "@the-office/contracts";
import { ideaQueries, planIdea, taskQueries } from "../../api/work.ts";
import { useToast } from "../toasts.tsx";
import { usePlanner } from "./use-planner.ts";

/** Plan as a Task with the Planner: the Idea becomes a Task in the Project, planned at once. */
export function useIdeaPlanning(idea: Idea): UseMutationResult<Task, Error, string> {
  const queryClient = useQueryClient();
  const onPlanned = useOnPlanned();
  return useMutation({
    mutationFn: (projectId: string) => planIdea(idea.id, projectId),
    onSuccess: onPlanned,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(ideaQueries.list()),
        queryClient.invalidateQueries(taskQueries.list()),
      ]),
  });
}

/**
 * The Task is in Planning: its page opens on its planning Thread, where the Planner starts on the
 * user's first message.
 */
export function useOnPlanned(): (task: Task) => Promise<void> {
  const showToast = useToast();
  const navigate = useNavigate();
  const planner = usePlanner()?.card.name ?? "whoever holds Plans";
  return async (task) => {
    showToast(
      `${task.title} is in Planning: message ${planner} to start, or write the Plan yourself.`,
    );
    await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
  };
}
