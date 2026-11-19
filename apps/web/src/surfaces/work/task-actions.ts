import type { Task, TaskStage } from "@the-office/contracts";
import { useRestoreAction } from "./archive-parts.tsx";
import { usePlanningActions } from "./planning-actions.tsx";
import { pullRequestAction } from "./pull-request-button.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { useRunControlActions } from "./run-controls.tsx";
import { useStartActions } from "./start-action.tsx";

/**
 * Every action of the Task page's head, in its order: planning, Start or the queue's, the run
 * controls, Open pull request and Restore, each while it is offered. Its buttons and its More menu
 * both show them.
 */
export function useTaskActions(
  task: Task,
  taskStages: readonly TaskStage[] | null | undefined,
): RecordAction[] {
  const planning = usePlanningActions(task);
  const start = useStartActions(task);
  const runControls = useRunControlActions(task);
  const restore = useRestoreAction(task);
  const pullRequest = pullRequestAction(taskStages, task.pullRequestEnd);
  return [
    ...planning,
    ...start,
    ...runControls,
    ...(pullRequest ? [pullRequest] : []),
    ...(restore ? [restore] : []),
  ];
}
