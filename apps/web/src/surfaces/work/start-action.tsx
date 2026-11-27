import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  Overlap,
  OverlapChoice,
  QueuedTask,
  StartAnswer,
  StartCheck,
  Task,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { UsageEstimateLine } from "../../shell/work/usage-estimate-line.tsx";
import { QueuedMark, useQueueActions, useQueued } from "./queue-parts.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { useStartPastLimitsAction } from "./start-past-limits.tsx";
import { useStartPastUsageCapsAction } from "./start-past-usage-caps.tsx";

interface StartStanding {
  readonly ready: boolean;
  readonly check: StartCheck | undefined;
  readonly queued: QueuedTask | undefined;
  readonly refused: boolean;
  readonly blockers: StartCheck["blockers"];
  readonly overlaps: readonly Overlap[];
}

/**
 * Where the Task stands for Start, which the buttons and the notes both follow: a refusal outranks
 * its blockers and Overlaps.
 */
function useStartStanding(task: Task): StartStanding {
  const ready = task.state === "ready";
  const check = useQuery({ ...taskQueries.startCheck(task.id), enabled: ready }).data;
  const queued = useQueued(task.id);
  const refused = (check?.refusals.length ?? 0) > 0;
  return {
    ready,
    check,
    queued,
    refused,
    blockers: refused ? [] : (check?.blockers ?? []),
    overlaps: refused ? [] : (check?.overlaps ?? []),
  };
}

/**
 * Start on a Ready Task (prototypes/app/task.js): disabled while a vacant Role refuses it. An
 * Overlap with a Task in progress in the Project makes Start "Start anyway" or "Queue behind it"
 * (spec §2.1, "Overlaps at Start"). A blocked Task can't start anyway, so "Queue behind it" is all
 * it offers, behind any Overlap too. A queued Task has the queue's actions instead, after Start
 * anyway while only its usage holds it (spec §2.1, "Start anyway past the usage caps"). What each
 * of these says is in `StartNotes`. While the Office-wide or the Project limit holds it, Start now
 * follows them, queued or not, starting it anyway past an Overlap not yet answered (spec §2.1,
 * "Start now past the limits"). None but on a Ready Task.
 */
export function useStartActions(task: Task): RecordAction[] {
  const standing = useStartStanding(task);
  const startNow = useStartPastLimitsAction(
    task,
    standing.check?.pastLimits,
    standing.queued ? [] : standing.overlaps,
  );
  const actions = useStartingActions(task, standing);
  return startNow && actions.length > 0 ? [...actions, startNow] : actions;
}

function useStartingActions(
  task: Task,
  { ready, check, queued, refused, blockers, overlaps }: StartStanding,
): RecordAction[] {
  const starting = useStarting();
  const queueActions = useQueueActions(queued);
  const startPastCaps = useStartPastUsageCapsAction(task, queued && check?.pastUsageCaps);
  if (!ready) return [];
  if (queued) return startPastCaps ? [startPastCaps, ...queueActions] : queueActions;
  const startWith = (onOverlap: OverlapChoice | undefined) => starting.mutate({ task, onOverlap });
  const pendingFor = (onOverlap: OverlapChoice | undefined) =>
    starting.isPending && starting.variables.onOverlap === onOverlap;
  if (blockers.length > 0 || overlaps.length > 0) {
    const queueBehind = overlaps.length > 0 ? "queue-behind" : undefined;
    const behind = new Set([...blockers, ...overlaps].map(({ taskId }) => taskId));
    const queueBehindAction: RecordAction = {
      key: "queue-behind",
      label: behind.size === 1 ? "Queue behind it" : "Queue behind them",
      icon: "clock",
      tone: "hold",
      zone: "hold",
      disabled: starting.isPending,
      pending: pendingFor(queueBehind),
      onSelect: () => startWith(queueBehind),
    };
    if (blockers.length > 0) return [queueBehindAction];
    return [
      {
        key: "start-anyway",
        label: "Start anyway",
        icon: "play",
        tone: "go",
        variant: "primary",
        disabled: starting.isPending,
        pending: pendingFor("start-anyway"),
        onSelect: () => startWith("start-anyway"),
      },
      queueBehindAction,
    ];
  }
  return [
    {
      key: "start",
      label: "Start",
      icon: "play",
      tone: "go",
      variant: "primary",
      disabled: !check || refused,
      pending: starting.isPending,
      onSelect: () => startWith(undefined),
    },
  ];
}

/**
 * What the Task head says about Start, a line each, nothing with none to say: the Overlaps, what
 * Start would do (spec §2.1, "A queue for Start") and the Usage estimate; or, for a queued Task, its
 * place and reasons.
 */
export function StartNotes({ task }: { readonly task: Task }): ReactNode {
  const { ready, check, queued, overlaps } = useStartStanding(task);
  if (!ready) return null;
  if (queued) {
    return (
      <div className="task-head-notes">
        <QueuedMark queued={queued} />
      </div>
    );
  }
  if (check === undefined || !hasNote(check, overlaps)) return null;
  return (
    <div className="task-head-notes">
      {overlaps.length > 0 && <OverlapNote overlaps={overlaps} />}
      <HeldNote check={check} />
      <UsageEstimateLine estimate={check.usageEstimate} />
    </div>
  );
}

function hasNote(check: StartCheck, overlaps: readonly Overlap[]): boolean {
  return (
    overlaps.length > 0 ||
    check.refusals.length > 0 ||
    check.blockers.length > 0 ||
    check.waits.length > 0 ||
    check.usageEstimate !== null
  );
}

/** Each Task in progress in the Project expecting to change some of the same files, a line each. */
function OverlapNote({ overlaps }: { readonly overlaps: readonly Overlap[] }): ReactNode {
  return (
    <div className="task-head-overlaps" role="note" aria-label="Overlap">
      {overlaps.map(({ taskId, title }) => (
        <span key={taskId} className="task-head-note">
          <Icon name="files" size={14} />
          <span>
            Overlap: &ldquo;{title}&rdquo; is in progress and expects to change some of the same
            files.
          </span>
        </span>
      ))}
    </div>
  );
}

/** What stops Start, else the waits it would queue behind (a cap's in the service's words). */
function HeldNote({ check }: { readonly check: StartCheck }): ReactNode {
  if (check.refusals.length > 0 || check.blockers.length > 0) {
    return (
      <span className="task-head-note">
        <Icon name="lock" size={14} />
        <span>{[...check.refusals, ...check.waits].join(" ")}</span>
      </span>
    );
  }
  if (check.waits.length === 0) return null;
  return (
    <span className="task-head-note">
      <Icon name="clock" size={14} />
      <span>Start joins the queue: {check.waits.join(" ")}</span>
    </span>
  );
}

interface StartRequest {
  readonly task: Task;
  readonly onOverlap: OverlapChoice | undefined;
}

function useStarting(): UseMutationResult<StartAnswer, Error, StartRequest> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: ({ task, onOverlap }: StartRequest) =>
      startTask(task.id, onOverlap ? { onOverlap } : {}),
    onSuccess: ({ task, queued }) =>
      showToast(
        queued
          ? `${task.title} is queued, place ${queued.place}: ${queued.reasons.join(" ")}`
          : `${task.title} started.`,
      ),
    onError: (error) => showToast(error.message),
    onSettled: async (_answer, _error, { task }) => {
      await queryClient.invalidateQueries(taskQueries.list());
      await queryClient.invalidateQueries(taskQueries.queue());
      // A refusal may be an Overlap that arose since the check was read.
      await queryClient.invalidateQueries(taskQueries.startCheck(task.id));
    },
  });
}
