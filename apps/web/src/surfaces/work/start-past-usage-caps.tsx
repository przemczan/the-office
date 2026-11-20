import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { PastUsageCaps, StartAnswer, Task } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import type { RecordAction } from "./record-actions.tsx";

/*
 * Start anyway past the usage caps (spec §2.1, "Start anyway past the usage caps"): a queued Task
 * only its usage holds starts now at the user's word, once they confirm the caps it passes and the
 * engines it runs on. Disabled, with why, while every engine its Stages could run on is used up.
 */

/** The Task page's Start anyway on a queued Task; undefined unless only its usage holds it. */
export function useStartPastUsageCapsAction(
  task: Pick<Task, "id" | "title">,
  pastUsageCaps: PastUsageCaps | null | undefined,
): RecordAction | undefined {
  const [asking, setAsking] = useState(false);
  if (!pastUsageCaps) return undefined;
  const cannot = pastUsageCaps.refusals.length > 0;
  return {
    key: "start-past-usage-caps",
    label: "Start anyway",
    icon: "play",
    variant: "primary",
    hint: cannot ? pastUsageCaps.refusals.join(" ") : "Start it now, past its usage caps",
    disabled: cannot,
    onSelect: () => setAsking(true),
    ...(asking && {
      dialog: (
        <StartPastUsageCapsDialog
          task={task}
          pastUsageCaps={pastUsageCaps}
          onClose={() => setAsking(false)}
        />
      ),
    }),
  };
}

/** Asks before starting the Task past its usage caps, naming each cap and the engines it runs on. */
export function StartPastUsageCapsDialog({
  task,
  pastUsageCaps: { passes, engines },
  onClose,
}: {
  readonly task: Pick<Task, "id" | "title">;
  readonly pastUsageCaps: PastUsageCaps;
  readonly onClose: () => void;
}): ReactNode {
  const starting = useStartingPastUsageCaps();
  const start = (): void => starting.mutate(task, { onSuccess: onClose });
  return (
    <Dialog
      size="small"
      title={`Start ${task.title} anyway?`}
      onClose={onClose}
      actions={
        <Button variant="primary" loading={starting.isPending} onClick={start}>
          Start anyway
        </Button>
      }
    >
      <div className="dialog-stack">
        {starting.error && <RefusalAlert title="It can't start" error={starting.error} />}
        {passes.length > 0 && (
          <>
            <p className="dialog-text">It starts now, past these usage caps:</p>
            <ul className="dialog-text start-past-usage-caps">
              {passes.map((cap) => (
                <li key={cap}>{cap}</li>
              ))}
            </ul>
          </>
        )}
        <p className="dialog-text">Its Stages run on {engineWords(engines)}.</p>
        <p className="dialog-text">
          Its Usage estimate counts against the caps as usual for the Starts and the queue after it.
        </p>
      </div>
    </Dialog>
  );
}

/** "Personal, standing in for Work, and Lab". */
export function engineWords(engines: PastUsageCaps["engines"]): string {
  const named = engines.map(({ name, standingInFor }) =>
    standingInFor ? `${name}, standing in for ${standingInFor}` : name,
  );
  if (named.length <= 1) return named[0] ?? "its engines";
  return `${named.slice(0, -1).join("; ")} and ${named.at(-1)}`;
}

function useStartingPastUsageCaps(): UseMutationResult<
  StartAnswer,
  Error,
  Pick<Task, "id" | "title">
> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: ({ id }: Pick<Task, "id" | "title">) =>
      startTask(id, { onUsageCaps: "start-anyway" }),
    onSuccess: ({ task }) => showToast(`${task.title} started.`),
    onSettled: async (_answer, _error, { id }) => {
      await queryClient.invalidateQueries(taskQueries.list());
      await queryClient.invalidateQueries(taskQueries.queue());
      await queryClient.invalidateQueries(taskQueries.startCheck(id));
    },
  });
}
