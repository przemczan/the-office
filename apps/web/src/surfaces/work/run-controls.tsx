import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role, Task, TaskStage, Thread, WayBack } from "@the-office/contracts";
import { useState } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { pauseTask, resumeTask, stopTask, taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { RestartTaskDialog } from "../../shell/work/restart-task-dialog.tsx";
import { StartOverDialog } from "../../shell/work/start-over-dialog.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { latestRunOf, resumeWords } from "./resume-words.ts";

/**
 * Pause and Stop while a Task is In progress or Waiting on you, Resume once it is Paused
 * (prototypes/app/task.js, spec §2.4). Resume's label says how the Task goes on. Beside it, on a
 * Task held by the user's own Pause or Stop, Restart from… and Start over, each disabled with why
 * while the service doesn't offer it (spec §2.4.5).
 */
export function useRunControlActions(task: Task): RecordAction[] {
  const paused = task.state === "paused";
  const pausing = useRunControl(pauseTask, "Pausing once the Agent's current turn ends.");
  const stopping = useRunControl(stopTask, "Stopped: the Stage's uncommitted edits are discarded.");
  const resume = useResumeAction(task, paused);
  const waysBack = useWaysBackActions(task, paused && task.pausedBy === null);
  if (paused) return [resume, ...waysBack];
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return [];
  return [
    {
      key: "pause",
      label: "Pause",
      icon: "pause",
      tone: "hold",
      hint: "Hold the Task once the Agent's current turn ends, keeping the Stage's edits",
      pending: pausing.isPending,
      onSelect: () => pausing.mutate(task.id),
    },
    {
      key: "stop",
      label: "Stop",
      icon: "square",
      tone: "stop",
      hint: "Interrupt the Agent now and discard the Stage's uncommitted edits",
      pending: stopping.isPending,
      onSelect: () => stopping.mutate(task.id),
    },
  ];
}

type OpenWayBack = "restart" | "start-over";

/** Restart from… and Start over, with the window each opens; none until the ways back are read. */
function useWaysBackActions(task: Task, offered: boolean): RecordAction[] {
  const waysBack = useQuery({ ...taskQueries.waysBack(task.id), enabled: offered }).data;
  const [open, setOpen] = useState<OpenWayBack>();
  if (!offered || waysBack === undefined) return [];
  const close = (): void => setOpen(undefined);
  return [
    {
      key: "restart",
      label: "Restart from…",
      icon: "rotate-ccw",
      tone: "go",
      ...offeredOrWhy(
        waysBack.restart,
        "End the held run and go on from a Stage you pick, with feedback if you like",
      ),
      onSelect: () => setOpen("restart"),
      ...(open === "restart" && { dialog: <RestartTaskDialog task={task} onClose={close} /> }),
    },
    {
      key: "start-over",
      label: "Start over",
      icon: "refresh-ccw",
      tone: "go",
      ...offeredOrWhy(
        waysBack.startOver,
        "Take the Task back to Ready, to start from its first Stage",
      ),
      onSelect: () => setOpen("start-over"),
      ...(open === "start-over" && {
        dialog: <StartOverDialog task={task} waysBack={waysBack} onClose={close} />,
      }),
    },
  ];
}

/** An offered way back hints what it does; one not offered is disabled and says why on hover. */
export function offeredOrWhy(
  wayBack: WayBack,
  hint: string,
): Pick<RecordAction, "hint" | "disabled"> {
  if (wayBack.offered) return { hint };
  return { hint: wayBack.why ?? "Not offered now", disabled: true };
}

/** Resume, its words read only while the Task is paused. */
function useResumeAction(task: Task, paused: boolean): RecordAction {
  const stages = useQuery({ ...pipelineQueries.taskStages(task.id), enabled: paused }).data;
  const roles = useQuery({ ...roleQueries.list(), enabled: paused }).data;
  const decisionOpen = (useQuery({ ...decisionQueries.open(), enabled: paused }).data ?? []).some(
    ({ taskId }) => taskId === task.id,
  );
  const latest = latestRunOf(stages?.stages ?? []);
  const thread = useStageThread(paused ? (latest?.run.threadId ?? null) : null);
  const resuming = useRunControl(resumeTask, "Resumed.");
  const words = resumeWords({
    latestRun: latest?.run,
    thread,
    personName: personOf(latest?.taskStage, roles),
    decisionOpen,
  });
  return {
    key: "resume",
    label: words.label,
    icon: "play",
    tone: "go",
    variant: "primary",
    hint: words.hint,
    pending: resuming.isPending,
    onSelect: () => resuming.mutate(task.id),
  };
}

/** The run's Stage Thread, whose context label tells how the Stage goes on; none for a script. */
function useStageThread(threadId: string | null): Thread | undefined {
  const one = threadId === null ? undefined : threadQueries.one(threadId);
  return useQuery({
    queryKey: one?.queryKey ?? ["threads", "none"],
    queryFn: one?.queryFn ?? skipToken,
  }).data;
}

/** Who works the Stage: the Role it names, or whoever works its duty (`workedBy`). */
function personOf(taskStage: TaskStage | undefined, roles: readonly Role[] | undefined): string {
  const stage = taskStage?.stage;
  const roleKey = stage?.kind === "agent" ? (stage.role ?? taskStage?.workedBy) : undefined;
  const role = roles?.find(({ key }) => key === roleKey);
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
