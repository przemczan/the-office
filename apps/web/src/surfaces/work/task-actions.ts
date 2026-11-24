import type { Task, TaskStage } from "@the-office/contracts";
import { useRestoreAction } from "./archive-parts.tsx";
import { useBrowseFilesAction } from "./browse-files.tsx";
import { usePlanningActions } from "./planning-actions.tsx";
import { pullRequestAction } from "./pull-request-button.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { useReopenAction } from "./reopen-action.tsx";
import { useRunControlActions } from "./run-controls.tsx";
import { useStartActions } from "./start-action.tsx";

/**
 * Every action of the Task page's head, in its order: planning, Start or the queue's, the run
 * controls (with Restart from… and Start over), Reopen…, Open pull request, Browse files and
 * Restore, each while it is offered. Its buttons and
 * its More menu both show them.
 */
export function useTaskActions(
  task: Task,
  taskStages: readonly TaskStage[] | null | undefined,
): RecordAction[] {
  const planning = usePlanningActions(task);
  const start = useStartActions(task);
  const runControls = useRunControlActions(task);
  const reopen = useReopenAction(task);
  const restore = useRestoreAction(task);
  const pullRequest = pullRequestAction(taskStages, task.pullRequestEnd);
  const browseFiles = useBrowseFilesAction(task);
  return [
    ...planning,
    ...start,
    ...runControls,
    ...(reopen ? [reopen] : []),
    ...(pullRequest ? [pullRequest] : []),
    ...(browseFiles ? [browseFiles] : []),
    ...(restore ? [restore] : []),
  ];
}
