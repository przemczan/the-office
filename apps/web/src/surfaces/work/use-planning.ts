import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Idea, Task } from "@the-office/contracts";
import { ideaQueries, markReady, planIdea, planTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";

/**
 * Plan with the Planner: the Task moves to Planning with its planning Thread, and its page opens
 * on it. A refusal, such as a worktree that couldn't be made, shows with its reason.
 */
export function usePlanning(): UseMutationResult<Task, Error, Task> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const onPlanned = useOnPlanned();
  return useMutation({
    mutationFn: (task: Task) => planTask(task.id),
    onSuccess: onPlanned,
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}

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

/** Whether every line of the Task's "Before Ready" checklist is met; false until it is known. */
export function useReadyConditionsMet(task: Task): boolean {
  const readiness = useQuery({
    ...taskQueries.readiness(task.id),
    enabled: task.state === "planning",
  });
  return readiness.data?.lines.every(({ met }) => met) ?? false;
}

/** Mark Ready, which the checklist keeps from being offered before every line is met. */
export function useMarkingReady(): UseMutationResult<Task, Error, Task> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (task: Task) => markReady(task.id),
    onSuccess: (ready) => showToast(`${ready.title} is Ready. Starting it is your call.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}

function useOnPlanned(): (task: Task) => Promise<void> {
  const showToast = useToast();
  const navigate = useNavigate();
  const planner = usePlanner()?.card.name ?? "the Planner";
  return async (task) => {
    showToast(`${task.title} is in Planning with ${planner}.`);
    await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
  };
}
