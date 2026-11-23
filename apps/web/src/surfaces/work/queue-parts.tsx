import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PastUsageCaps, QueuedTask, Task } from "@the-office/contracts";
import { Badge, Button, Icon, Popover, SplitButton } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { Fragment, useState, type ReactNode } from "react";
import { moveToTopOfQueue, moveUpInQueue, takeOutOfQueue, taskQueries } from "../../api/work.ts";
import { counted } from "../../shell/pipelines/pipeline-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { distinctShortReasons, reasonsBesideBlockers } from "./queue-reasons.ts";
import { RecordActionButton, type RecordAction } from "./record-actions.tsx";
import { StartPastUsageCapsDialog } from "./start-past-usage-caps.tsx";

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
 * full reasons and the Tasks it is queued behind as links, then Start anyway while only its usage
 * holds it, which asks first in a dialog of its own, as the popover closes on a press outside it.
 * The waits beside its blockers only, as the card's lock holds those.
 */
export function QueuedCardMark({
  task,
  queued,
  behind,
  blockers,
}: {
  readonly task: Pick<Task, "id" | "title">;
  readonly queued: QueuedTask;
  /** The Tasks it is queued behind for an Overlap. */
  readonly behind: readonly Pick<Task, "id" | "title">[];
  /** How many Tasks block it. */
  readonly blockers: number;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<PastUsageCaps>();
  const reasons = reasonsBesideBlockers(queued);
  const shortReasons = distinctShortReasons(reasons);
  return (
    <>
      <Popover
        label="Queued"
        triggerClassName="card-mark card-mark-info"
        trigger={<Icon name="clock" size={13} />}
        open={open}
        onOpenChange={setOpen}
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
        <StartPastUsageCapsButton
          taskId={task.id}
          onSelect={(pastUsageCaps) => {
            setOpen(false);
            setAsking(pastUsageCaps);
          }}
        />
      </Popover>
      {asking && (
        <StartPastUsageCapsDialog
          task={task}
          pastUsageCaps={asking}
          onClose={() => setAsking(undefined)}
        />
      )}
    </>
  );
}

/**
 * The popover's Start anyway, read as it opens: none unless only the Task's usage holds it, and
 * disabled, with why, while every engine its Stages could run on is used up.
 */
function StartPastUsageCapsButton({
  taskId,
  onSelect,
}: {
  readonly taskId: string;
  readonly onSelect: (pastUsageCaps: PastUsageCaps) => void;
}): ReactNode {
  const pastUsageCaps = useQuery(taskQueries.startCheck(taskId)).data?.pastUsageCaps;
  if (!pastUsageCaps) return null;
  const cannot = pastUsageCaps.refusals.join(" ");
  return (
    <div className="queued-start-anyway">
      <Button
        variant="primary"
        size="sm"
        iconLeft={<Icon name="play" size={14} />}
        disabled={cannot !== ""}
        onClick={() => onSelect(pastUsageCaps)}
      >
        Start anyway
      </Button>
      {cannot !== "" && <p>{cannot}</p>}
    </div>
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
  return useQueueActions(queued, size).map((action) => (
    <Fragment key={action.key}>
      <RecordActionButton action={action} size={size} />
    </Fragment>
  ));
}

/**
 * The queue's actions on a queued Task, none on one that isn't: Move up and Move to top, a split
 * button, unless it is first, and Take out of the queue.
 */
export function useQueueActions(
  queued: QueuedTask | undefined,
  size: "sm" | "md" = "md",
): RecordAction[] {
  const movingUp = useQueueChange(moveUpInQueue, "Moved up in the queue.");
  const movingToTop = useQueueChange(moveToTopOfQueue, "Moved to the top of the queue.");
  const takingOut = useQueueChange(takeOutOfQueue, "Taken out of the queue; it stays Ready.");
  if (!queued) return [];
  const moving = movingUp.isPending || movingToTop.isPending;
  const moveUp = (): void => movingUp.mutate(queued.taskId);
  const moveToTop = (): void => movingToTop.mutate(queued.taskId);
  const takeOut: RecordAction = {
    key: "take-out-of-queue",
    label: "Take out of the queue",
    icon: "x",
    tone: "stop",
    variant: "ghost",
    pending: takingOut.isPending,
    onSelect: () => takingOut.mutate(queued.taskId),
  };
  if (queued.place === 1) return [takeOut];
  return [
    {
      key: "move-up",
      label: "Move up",
      icon: "arrow-up",
      pending: moving,
      onSelect: moveUp,
      control: (
        <SplitButton
          variant="secondary"
          size={size}
          iconLeft={<Icon name="arrow-up" size={14} />}
          loading={moving}
          onClick={moveUp}
          menuLabel="More ways to move up"
          items={[
            {
              label: "Move to top",
              icon: <Icon name="arrow-up-to-line" size={14} />,
              onSelect: moveToTop,
            },
          ]}
        >
          Move up
        </SplitButton>
      ),
    },
    // In Move up's split button.
    {
      key: "move-to-top",
      label: "Move to top",
      icon: "arrow-up-to-line",
      pending: moving,
      onSelect: moveToTop,
      control: null,
    },
    takeOut,
  ];
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
