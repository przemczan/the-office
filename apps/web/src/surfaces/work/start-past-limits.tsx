import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Overlap, PastLimits, StartAnswer, Task } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import type { RecordAction } from "./record-actions.tsx";

/*
 * Start now past the limits (spec §2.1, "Start now past the limits"): a Ready Task the Office-wide
 * limit or its Project limit holds starts at once at the user's word, once they confirm the limits
 * it passes and any Overlap it starts anyway past, and never joins the queue. Disabled, with why,
 * while anything else holds it.
 */

/**
 * The Task page's Start now; undefined unless the Office-wide or the Project limit holds it.
 * `overlaps` are those not yet answered, which Start now starts anyway past.
 */
export function useStartPastLimitsAction(
  task: Pick<Task, "id" | "title">,
  pastLimits: PastLimits | null | undefined,
  overlaps: readonly Overlap[],
): RecordAction | undefined {
  const [asking, setAsking] = useState(false);
  if (!pastLimits) return undefined;
  const cannot = pastLimits.refusals.length > 0;
  return {
    key: "start-past-limits",
    label: "Start now",
    icon: "play",
    tone: "go",
    variant: "secondary",
    hint: cannot ? pastLimits.refusals.join(" ") : "Start it now, past the limits and the queue",
    disabled: cannot,
    onSelect: () => setAsking(true),
    ...(asking && {
      dialog: (
        <StartPastLimitsDialog
          task={task}
          pastLimits={pastLimits}
          overlaps={overlaps}
          onClose={() => setAsking(false)}
        />
      ),
    }),
  };
}

/** Asks before starting the Task past the limits, naming each limit and Overlap it passes. */
function StartPastLimitsDialog({
  task,
  pastLimits: { passes },
  overlaps,
  onClose,
}: {
  readonly task: Pick<Task, "id" | "title">;
  readonly pastLimits: PastLimits;
  readonly overlaps: readonly Overlap[];
  readonly onClose: () => void;
}): ReactNode {
  const starting = useStartingPastLimits();
  const start = (): void =>
    starting.mutate({ task, pastOverlaps: overlaps.length > 0 }, { onSuccess: onClose });
  return (
    <Dialog
      size="small"
      title={`Start ${task.title} now?`}
      onClose={onClose}
      actions={
        <Button variant="primary" loading={starting.isPending} onClick={start}>
          Start now
        </Button>
      }
    >
      <div className="dialog-stack">
        {starting.error && <RefusalAlert title="It can't start" error={starting.error} />}
        <p className="dialog-text">It starts at once, without waiting in the queue, past:</p>
        <ul className="dialog-text start-past-usage-caps">
          {passes.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
          {overlaps.map(({ taskId, title }) => (
            <li key={taskId}>Overlap with &ldquo;{title}&rdquo;</li>
          ))}
        </ul>
        <p className="dialog-text">
          It counts as started for the limits of the Starts and the queue after it.
        </p>
      </div>
    </Dialog>
  );
}

interface StartNowRequest {
  readonly task: Pick<Task, "id" | "title">;
  /** Whether it starts anyway past the Overlaps it was not yet queued behind. */
  readonly pastOverlaps: boolean;
}

function useStartingPastLimits(): UseMutationResult<StartAnswer, Error, StartNowRequest> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: ({ task, pastOverlaps }: StartNowRequest) =>
      startTask(task.id, {
        onLimits: "start-anyway",
        ...(pastOverlaps && { onOverlap: "start-anyway" }),
      }),
    onSuccess: ({ task }) => showToast(`${task.title} started.`),
    onSettled: async (_answer, _error, { task }) => {
      await queryClient.invalidateQueries(taskQueries.list());
      await queryClient.invalidateQueries(taskQueries.queue());
      await queryClient.invalidateQueries(taskQueries.startCheck(task.id));
    },
  });
}
