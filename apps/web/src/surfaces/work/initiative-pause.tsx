import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Initiative, InitiativePauseAnswer } from "@the-office/contracts";
import { Badge, Icon, type BadgeProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import {
  initiativeQueries,
  pauseInitiative,
  resumeInitiative,
  taskQueries,
} from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import type { RecordAction } from "./record-actions.tsx";

/** Paused: a mark beside an active Initiative's state, until it is resumed (spec §2.1). */
export function isInitiativePaused(initiative: Pick<Initiative, "pausedAt">): boolean {
  return initiative.pausedAt !== null;
}

/** Pause the Initiative is offered while it is active and not paused. */
export function canPauseInitiative(initiative: Initiative): boolean {
  return initiative.state === "active" && !isInitiativePaused(initiative);
}

/** The toast after Pause the Initiative, by how many of its Tasks it paused. */
export function pausedWords(taskCount: number): string {
  const held =
    taskCount === 0 ? "none of its Tasks was running" : `${tasksWords(taskCount)} paused`;
  return `Initiative paused: ${held}. None of its Tasks starts until you resume it.`;
}

/**
 * The toast after Resume the Initiative, by how many Tasks its Pause held; while the fire alarm is
 * on, they go on at the all clear.
 */
export function resumedWords(taskCount: number, fireAlarmOn: boolean): string {
  if (taskCount === 0) return "Initiative resumed: its Tasks may start again.";
  const tasks = tasksWords(taskCount);
  const goOn = taskCount === 1 ? "goes on" : "go on";
  return fireAlarmOn
    ? `Initiative resumed: ${tasks} ${goOn} at the fire alarm's all clear.`
    : `Initiative resumed: ${tasks} resumed.`;
}

function tasksWords(count: number): string {
  return count === 1 ? "1 Task" : `${count} Tasks`;
}

/** The Paused badge, while the Initiative is paused; small on a card. */
export function InitiativePausedBadge({
  initiative,
  size,
}: {
  readonly initiative: Pick<Initiative, "pausedAt">;
  readonly size?: BadgeProps["size"];
}): ReactNode {
  if (!isInitiativePaused(initiative)) return null;
  return (
    <Badge tone="warning" size={size}>
      <Icon name="pause" size={size === "sm" ? 11 : 12} />
      Paused
    </Badge>
  );
}

/**
 * Pause the Initiative while it is active and not paused, Resume the Initiative while it is: the
 * answer replaces the shown Initiative, and the Task list, whose key leads the queue's and every
 * Start check's, is read again. A refusal's reason shows as a toast.
 */
export function useInitiativePauseAction(initiative: Initiative): RecordAction | undefined {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const fireAlarmOn = (useQuery(nowQueries.now()).data?.fireAlarm ?? null) !== null;
  const paused = isInitiativePaused(initiative);
  const changing = useMutation({
    mutationFn: () => (paused ? resumeInitiative(initiative.id) : pauseInitiative(initiative.id)),
    onSuccess: ({ initiative: changed, taskIds }: InitiativePauseAnswer) => {
      queryClient.setQueryData(initiativeQueries.one(initiative.id).queryKey, changed);
      showToast(
        isInitiativePaused(changed)
          ? pausedWords(taskIds.length)
          : resumedWords(taskIds.length, fireAlarmOn),
      );
    },
    onError: (error) => showToast(error.message),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries(initiativeQueries.list()),
        queryClient.invalidateQueries(taskQueries.list()),
      ]);
    },
  });
  if (!paused && !canPauseInitiative(initiative)) return undefined;
  return {
    key: "pause-initiative",
    label: paused ? "Resume the Initiative" : "Pause the Initiative",
    icon: paused ? "play" : "pause",
    hint: paused
      ? "Resume the Tasks its Pause held and let its Tasks start again"
      : "Hold its running Tasks once each Agent's current turn ends, and start none of its Tasks",
    pending: changing.isPending,
    onSelect: () => changing.mutate(),
  };
}
