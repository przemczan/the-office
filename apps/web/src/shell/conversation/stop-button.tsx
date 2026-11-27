import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { IconButton, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { stopThread, threadQueries } from "../../api/conversations.ts";

/**
 * Whether the user may stop the person in the Thread now (spec §2.4.5, "Stop in a person's
 * Thread"): they answer in it, and it is a Thread the user talks to a person in, which a Stage
 * Thread and a Consultation are not.
 */
export function mayStopThread(thread: Thread): boolean {
  return thread.state === "answering" && !thread.stageThread && thread.consultation === null;
}

export interface Stopping {
  readonly stop: () => void;
  /** The service is ending the turn; the button waits for it. */
  readonly pending: boolean;
  readonly error: Error | null;
}

/**
 * Stops the person's answer in the Thread. The turn ends as stopped (the Thread's own events say
 * so), so the Thread is read again once the service has answered.
 */
export function useStopping(thread: Thread): Stopping {
  const queryClient = useQueryClient();
  const stopping = useMutation({
    mutationFn: () => stopThread(thread.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries(threadQueries.one(thread.id));
    },
  });
  return {
    stop: () => {
      if (!stopping.isPending) stopping.mutate();
    },
    pending: stopping.isPending,
    error: stopping.error,
  };
}

/** The square between Mention and Send; Send stays beside it for a message that redirects them. */
export function StopButton({
  personName,
  stopping,
}: {
  readonly personName: string;
  readonly stopping: Stopping;
}): ReactNode {
  const { pending } = stopping;
  const label = pending ? `Stopping ${personName}…` : `Stop ${personName}`;
  return (
    <Tooltip
      content={
        pending ? (
          label
        ) : (
          <>
            Stop {personName} now
            <small className="tooltip-sub">
              The session is kept: your next message continues it.
            </small>
          </>
        )
      }
    >
      <IconButton
        className="composer-stop"
        icon={pending ? <span className="composer-stop-spinner" /> : <i className="stop-square" />}
        label={label}
        // The tooltip says it, with more.
        title=""
        aria-busy={pending || undefined}
        onClick={stopping.stop}
      />
    </Tooltip>
  );
}
