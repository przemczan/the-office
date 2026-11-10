import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { autoModeQuery, makeAPlan, markReady, planTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useOnPlanned } from "../../shell/work/use-idea-planning.ts";
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

/** What Make a plan is asked: the Task, and whether it is planned in auto mode. */
export interface MakingAPlan {
  readonly task: Task;
  readonly autoMode: boolean;
}

/**
 * Make a plan: the Task moves to Planning, and the Planner starts at once from its title and
 * Description, with nothing for the user to write. The page stays where it is. The auto mode it
 * was made in is the remembered default from then on.
 */
export function useMakingAPlan(): UseMutationResult<Task, Error, MakingAPlan> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const planner = usePlanner()?.card.name ?? "The Planner";
  return useMutation({
    mutationFn: ({ task, autoMode }: MakingAPlan) => makeAPlan(task.id, autoMode),
    onSuccess: (planning, { autoMode }) => {
      queryClient.setQueryData(taskQueries.one(planning.id).queryKey, planning);
      queryClient.setQueryData(autoModeQuery().queryKey, { autoMode });
      showToast(
        autoMode
          ? `${planning.title} is in Planning: ${planner} is making a plan, in auto mode.`
          : `${planning.title} is in Planning: ${planner} is making a plan.`,
      );
    },
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}

/** Whether Make a plan starts in auto mode, as the user last chose; off until it is known. */
export function useRememberedAutoMode(): boolean {
  return useQuery(autoModeQuery()).data?.autoMode ?? false;
}

/** Whether every line of the Task's "Before Ready" checklist is met; false until it is known. */
export function useReadyConditionsMet(task: Task): boolean {
  const readiness = useQuery({
    ...taskQueries.readiness(task.id),
    enabled: task.state === "planning" || task.state === "backlog",
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
