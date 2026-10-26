import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role, Stage, Task, Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { pauseTask, resumeTask, stopTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { latestRunOf, resumeWords } from "./resume-words.ts";

/**
 * Pause and Stop while a Task is In progress or Waiting on you, Resume once it is Paused
 * (prototypes/app/task.js, spec §2.4). Resume's label says how the Task goes on.
 */
export function RunControls({ task }: { readonly task: Task }): ReactNode {
  if (task.state === "paused") return <ResumeButton task={task} />;
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return null;
  return <PauseAndStop task={task} />;
}

function PauseAndStop({ task }: { readonly task: Task }): ReactNode {
  const pausing = useRunControl(pauseTask, "Pausing once the Agent's current turn ends.");
  const stopping = useRunControl(stopTask, "Stopped: the Stage's uncommitted edits are discarded.");
  return (
    <>
      <Button
        variant="secondary"
        iconLeft={<Icon name="pause" size={14} />}
        title="Hold the Task once the Agent's current turn ends, keeping the Stage's edits"
        loading={pausing.isPending}
        onClick={() => pausing.mutate(task.id)}
      >
        Pause
      </Button>
      <Button
        variant="secondary"
        iconLeft={<Icon name="square" size={14} />}
        title="Interrupt the Agent now and discard the Stage's uncommitted edits"
        loading={stopping.isPending}
        onClick={() => stopping.mutate(task.id)}
      >
        Stop
      </Button>
    </>
  );
}

function ResumeButton({ task }: { readonly task: Task }): ReactNode {
  const stages = useQuery(pipelineQueries.taskStages(task.id)).data?.stages ?? [];
  const roles = useQuery(roleQueries.list()).data;
  const decisionOpen = (useQuery(decisionQueries.open()).data ?? []).some(
    ({ taskId }) => taskId === task.id,
  );
  const latest = latestRunOf(stages);
  const thread = useStageThread(latest?.run.threadId ?? null);
  const resuming = useRunControl(resumeTask, "Resumed.");
  const words = resumeWords({
    latestRun: latest?.run,
    thread,
    personName: personOf(latest?.taskStage.stage, roles),
    decisionOpen,
  });
  return (
    <Button
      variant="primary"
      iconLeft={<Icon name="play" size={14} />}
      title={words.hint}
      loading={resuming.isPending}
      onClick={() => resuming.mutate(task.id)}
    >
      {words.label}
    </Button>
  );
}

/** The run's Stage Thread, whose context label tells how the Stage goes on; none for a script. */
function useStageThread(threadId: string | null): Thread | undefined {
  const one = threadId === null ? undefined : threadQueries.one(threadId);
  return useQuery({
    queryKey: one?.queryKey ?? ["threads", "none"],
    queryFn: one?.queryFn ?? skipToken,
  }).data;
}

function personOf(stage: Stage | undefined, roles: readonly Role[] | undefined): string {
  const role = stage?.kind === "agent" ? roles?.find(({ key }) => key === stage.role) : undefined;
  return role?.card.name ?? "the Agent";
}

/** Sends a Pause, Stop or Resume; the Task's own event refreshes the page. */
function useRunControl(control: (id: string) => Promise<Task>, done: string) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: control,
    onSuccess: (task) => {
      queryClient.setQueryData(taskQueries.one(task.id).queryKey, task);
      showToast(done);
    },
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}
