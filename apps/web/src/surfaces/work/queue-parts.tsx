import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueuedTask, Task } from "@the-office/contracts";
import { Badge, Button, Icon, Popover, SplitButton } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { moveToTopOfQueue, moveUpInQueue, takeOutOfQueue, taskQueries } from "../../api/work.ts";
import { counted } from "../../shell/pipelines/stage-change-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { distinctShortReasons, reasonsBesideBlockers } from "./queue-reasons.ts";

/** The Task's place in the queue for Start; undefined while it isn't queued. */
export function useQueued(taskId: string): QueuedTask | undefined {
  return useQuery(taskQueries.queue()).data?.find((queued) => queued.taskId === taskId);
}

/** "Queued" with the Task's place and the waits that hold it (spec §2.1, "A queue for Start"). */
export function QueuedMark({ queued }: { readonly queued: QueuedTask }): ReactNode {
  return (
    <span className="queued-mark">
      <Badge tone="info" size="sm">
        Queued
      </Badge>
      <span>
        Place {queued.place} · {queued.reasons.join(" ")}
      </span>
    </span>
  );
}

/**
 * A board card's Queued mark: the clock, its short reasons on hover, and on a press its place, the
 * full reasons and the Tasks it is queued behind as links. The waits beside its blockers only, as the
 * card's lock holds those.
 */
export function QueuedCardMark({
  queued,
  behind,
  blockers,
}: {
  readonly queued: QueuedTask;
  /** The Tasks it is queued behind for an Overlap. */
  readonly behind: readonly Pick<Task, "id" | "title">[];
  /** How many Tasks block it. */
  readonly blockers: number;
}): ReactNode {
  const reasons = reasonsBesideBlockers(queued);
  const shortReasons = distinctShortReasons(reasons);
  return (
    <Popover
      label="Queued"
      triggerClassName="card-mark card-mark-info"
      trigger={<Icon name="clock" size={13} />}
      tooltip={
        shortReasons.length > 0 ? (
          <span className="queued-short-reasons">Queued: {shortReasons.join(" · ")}</span>
        ) : (
          "Queued"
        )
      }
    >
      <p className="popover-head">
        <Icon name="clock" size={13} />
        Queued, place {queued.place}
      </p>
      <p className="popover-sub">
        It starts by itself once nothing holds it.{reasons.length > 0 && " Waiting for:"}
      </p>
      {reasons.length > 0 && (
        <ul className="queued-full-reasons">
          {reasons.map(({ reason }) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {behind.length > 0 && (
        <ul className="queued-behind">
          {behind.map(({ id, title }) => (
            <li key={id}>
              <Icon name="arrow-right" size={13} />
              <Link to="/tasks/$taskId" params={{ taskId: id }} draggable={false}>
                {title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {blockers > 0 && (
        <p className="popover-foot">
          And its {counted(blockers, "blocker", "blockers")}, under the lock.
        </p>
      )}
    </Popover>
  );
}

/**
 * "Move up", with "Move to top" in its menu (but for the first in the queue), and "Take out of the
 * queue".
 */
export function QueueActions({
  queued,
  size = "md",
}: {
  readonly queued: QueuedTask;
  readonly size?: "sm" | "md";
}): ReactNode {
  const movingUp = useQueueChange(moveUpInQueue, "Moved up in the queue.");
  const movingToTop = useQueueChange(moveToTopOfQueue, "Moved to the top of the queue.");
  const takingOut = useQueueChange(takeOutOfQueue, "Taken out of the queue; it stays Ready.");
  return (
    <>
      {queued.place > 1 && (
        <SplitButton
          variant="secondary"
          size={size}
          iconLeft={<Icon name="arrow-up" size={14} />}
          loading={movingUp.isPending || movingToTop.isPending}
          onClick={() => movingUp.mutate(queued.taskId)}
          menuLabel="More ways to move up"
          items={[
            {
              label: "Move to top",
              icon: <Icon name="arrow-up-to-line" size={14} />,
              onSelect: () => movingToTop.mutate(queued.taskId),
            },
          ]}
        >
          Move up
        </SplitButton>
      )}
      <Button
        variant="ghost"
        size={size}
        iconLeft={<Icon name="x" size={14} />}
        loading={takingOut.isPending}
        onClick={() => takingOut.mutate(queued.taskId)}
      >
        Take out of the queue
      </Button>
    </>
  );
}

/** Sends a change of the queue; the queue's own event refreshes every view of it. */
function useQueueChange(change: (taskId: string) => Promise<void>, done: string) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: change,
    onSuccess: () => showToast(done),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.queue()),
  });
}
