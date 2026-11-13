import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueuedTask } from "@the-office/contracts";
import { Badge, Button, Icon, SplitButton, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { moveToTopOfQueue, moveUpInQueue, takeOutOfQueue, taskQueries } from "../../api/work.ts";
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
 * A board card's short "Queued": the short reasons of the waits beside its blockers, which the card
 * names in its "Blocked by" line, with their full reasons on hover, and no place, which the Queued
 * column's order shows.
 */
export function QueuedCardMark({ queued }: { readonly queued: QueuedTask }): ReactNode {
  const reasons = reasonsBesideBlockers(queued);
  return (
    <span className="queued-mark">
      <Badge tone="info" size="sm">
        Queued
      </Badge>
      {reasons.length > 0 && (
        <Tooltip
          content={
            <span className="queued-full-reasons">
              {reasons.map(({ reason }) => (
                <span key={reason}>{reason}</span>
              ))}
            </span>
          }
        >
          <span className="queued-short-reasons">{distinctShortReasons(reasons).join(" · ")}</span>
        </Tooltip>
      )}
    </span>
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
