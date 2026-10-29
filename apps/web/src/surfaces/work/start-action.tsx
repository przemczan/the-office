import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { StartAnswer, StartCheck, Task } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { startTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { QueueActions, QueuedMark, useQueued } from "./queue-parts.tsx";

/**
 * Start on a Ready Task (prototypes/app/task.js): disabled with the reasons while a blocker or a
 * vacant Role refuses it; while only a limit holds it, Start says the Task joins the queue (spec
 * §2.1, "A queue for Start"). A queued Task shows its place, reasons and the queue's actions.
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
  return (
    <>
      {check.data && <StartNote check={check.data} />}
      <Button
        variant="primary"
        iconLeft={<Icon name="play" size={14} />}
        disabled={!check.data || refused}
        loading={starting.isPending}
        onClick={() => starting.mutate(task)}
      >
        Start
      </Button>
    </>
  );
}

/** Why Start can't run the Task now: the refusals, else the waits it would queue behind. */
function StartNote({ check }: { readonly check: StartCheck }): ReactNode {
  if (check.refusals.length > 0) {
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

function useStarting(): UseMutationResult<StartAnswer, Error, Task> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (task: Task) => startTask(task.id),
    onSuccess: ({ task, queued }) =>
      showToast(
        queued
          ? `${task.title} is queued, place ${queued.place}: ${queued.reasons.join(" ")}`
          : `${task.title} started.`,
      ),
    onError: (error) => showToast(error.message),
    onSettled: async () => {
      await queryClient.invalidateQueries(taskQueries.list());
      await queryClient.invalidateQueries(taskQueries.queue());
    },
  });
}
