import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Initiative, ReadyTasksStarted, TaskSummary } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { startReadyTasks, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import type { RecordAction } from "./record-actions.tsx";

/** Start Ready Tasks is offered while the Initiative is active and one of its Tasks is Ready. */
export function canStartReadyTasks(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): boolean {
  return initiative.state === "active" && initiativeTasks.some(({ state }) => state === "ready");
}

/** The run summed up for its toast, such as "2 started, 1 queued, 1 refused". */
export function readyTasksStartedWords({ started, queued, refused }: ReadyTasksStarted): string {
  return [
    [started.length, "started"] as const,
    [queued.length, "queued"] as const,
    [refused.length, "refused"] as const,
  ]
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${count} ${what}`)
    .join(", ");
}

/**
 * Start Ready Tasks in the Initiative's head: the normal Start on each of its Ready Tasks, an
 * Overlap queued behind. The answer goes to `onStarted` for the page's note; a refusal of the whole
 * action shows as a toast.
 */
export function useStartReadyTasksAction(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
  onStarted: (started: ReadyTasksStarted) => void,
): RecordAction | undefined {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const starting = useMutation({
    mutationFn: () => startReadyTasks(initiative.id),
    onSuccess: (started) => {
      onStarted(started);
      showToast(readyTasksStartedWords(started));
    },
    onError: (error) => showToast(error.message),
    // The Task list's key leads the queue's and every start check's, so this refreshes them all.
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
  if (!canStartReadyTasks(initiative, initiativeTasks)) return undefined;
  return {
    key: "start-ready-tasks",
    label: "Start Ready Tasks",
    icon: "play",
    pending: starting.isPending,
    onSelect: () => starting.mutate(),
  };
}

/**
 * What the last Start Ready Tasks did, under the Initiative's head until closed: page state alone,
 * as each Task's card and the queue go on showing where it stands.
 */
export function StartReadyTasksNote({
  started,
  onClose,
}: {
  readonly started: ReadyTasksStarted;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Alert
      tone={started.refused.length > 0 ? "warning" : "info"}
      title={`Start Ready Tasks: ${readyTasksStartedWords(started)}`}
      onClose={onClose}
    >
      <div className="start-ready-tasks">
        <StartedGroup title="Started" tasks={started.started} />
        <StartedGroup title="Queued" tasks={started.queued} />
        <StartedGroup title="Refused" tasks={started.refused} />
      </div>
    </Alert>
  );
}

interface StartedTask {
  readonly taskId: string;
  readonly title: string;
  readonly place?: number;
  readonly reasons?: readonly string[];
}

function StartedGroup({
  title,
  tasks,
}: {
  readonly title: string;
  readonly tasks: readonly StartedTask[];
}): ReactNode {
  if (tasks.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {tasks.map(({ taskId, title: taskTitle, place, reasons = [] }) => (
          <li key={taskId}>
            <Link to="/tasks/$taskId" params={{ taskId }}>
              {taskTitle}
            </Link>
            {place !== undefined && <span className="task-quiet"> · place {place}</span>}
            {reasons.length > 0 && <span>: {reasons.join(" ")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
