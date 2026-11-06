import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Overlap, OverlapChoice, StartAnswer, StartCheck, Task } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { UsageEstimateLine } from "../../shell/work/usage-estimate-line.tsx";
import { QueueActions, QueuedMark, useQueued } from "./queue-parts.tsx";

/**
 * Start on a Ready Task (prototypes/app/task.js): disabled with the reasons while a vacant Role
 * refuses it; while only a limit holds it, Start says the Task joins the queue (spec §2.1, "A queue
 * for Start"). An Overlap with a Task in progress in the Project names it and the files, and Start
 * becomes "Start anyway" or "Queue behind it" (spec §2.1, "Overlaps at Start"). A blocked Task can't
 * start anyway, so "Queue behind it" is all it offers, behind any Overlap too. A queued Task shows
 * its place, reasons and the queue's actions. Beside Start, the Task's Usage estimate.
 */
export function StartButton({ task }: { readonly task: Task }): ReactNode {
  const ready = task.state === "ready";
  const check = useQuery({ ...taskQueries.startCheck(task.id), enabled: ready });
  const queued = useQueued(task.id);
  const starting = useStarting();
  if (!ready) return null;
  if (queued) {
    return (
      <>
        <QueuedMark queued={queued} />
        <QueueActions queued={queued} />
      </>
    );
  }
  const refused = (check.data?.refusals.length ?? 0) > 0;
  const blockers = refused ? [] : (check.data?.blockers ?? []);
  const overlaps = refused ? [] : (check.data?.overlaps ?? []);
  const startWith = (onOverlap: OverlapChoice | undefined) => starting.mutate({ task, onOverlap });
  const loadingFor = (onOverlap: OverlapChoice | undefined) =>
    starting.isPending && starting.variables.onOverlap === onOverlap;
  if (blockers.length > 0 || overlaps.length > 0) {
    const queueBehind = overlaps.length > 0 ? "queue-behind" : undefined;
    const behind = new Set([...blockers, ...overlaps].map(({ taskId }) => taskId));
    return (
      <>
        {overlaps.length > 0 && <OverlapNote overlaps={overlaps} />}
        {check.data && <StartNote check={check.data} />}
        {blockers.length === 0 && (
          <Button
            variant="primary"
            iconLeft={<Icon name="play" size={14} />}
            disabled={starting.isPending}
            loading={loadingFor("start-anyway")}
            onClick={() => startWith("start-anyway")}
          >
            Start anyway
          </Button>
        )}
        <Button
          variant="secondary"
          iconLeft={<Icon name="clock" size={14} />}
          disabled={starting.isPending}
          loading={loadingFor(queueBehind)}
          onClick={() => startWith(queueBehind)}
        >
          {behind.size === 1 ? "Queue behind it" : "Queue behind them"}
        </Button>
      </>
    );
  }
  return (
    <>
      {check.data && <StartNote check={check.data} />}
      <Button
        variant="primary"
        iconLeft={<Icon name="play" size={14} />}
        disabled={!check.data || refused}
        loading={starting.isPending}
        onClick={() => startWith(undefined)}
      >
        Start
      </Button>
    </>
  );
}

/** Each Task in progress in the Project expecting to change some of the same files, and which. */
function OverlapNote({ overlaps }: { readonly overlaps: readonly Overlap[] }): ReactNode {
  return (
    <span className="task-head-note task-overlap-files" role="note" aria-label="Overlap">
      <Icon name="files" size={14} />
      <span>
        {overlaps.map(({ taskId, title, files }) => (
          <span key={taskId}>
            Overlap: &ldquo;{title}&rdquo; is in progress and expects to change{" "}
            {files.map((path, at) => (
              <span key={path}>
                {at > 0 && ", "}
                <code>{path}</code>
              </span>
            ))}{" "}
            too.{" "}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * What Start would do with the Task now: what stops it, else the waits it would queue behind (a
 * cap's in the service's words), then its Usage estimate.
 */
function StartNote({ check }: { readonly check: StartCheck }): ReactNode {
  return (
    <>
      <HeldNote check={check} />
      <UsageEstimateLine estimate={check.usageEstimate} />
    </>
  );
}

function HeldNote({ check }: { readonly check: StartCheck }): ReactNode {
  if (check.refusals.length > 0 || check.blockers.length > 0) {
    return (
      <span className="task-head-note">
        <Icon name="lock" size={14} />
        {[...check.refusals, ...check.waits].join(" ")}
      </span>
    );
  }
  if (check.waits.length === 0) return null;
  return (
    <span className="task-head-note">
      <Icon name="clock" size={14} />
      Start joins the queue: {check.waits.join(" ")}
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
    mutationFn: ({ task, onOverlap }: StartRequest) => startTask(task.id, onOverlap),
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
