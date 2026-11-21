import type { Initiative, TaskSummary } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { planInitiativeWith, useEveryTask } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { canPlanInitiative } from "./initiative-planning-words.ts";
import { tasksOfInitiative } from "./initiative-words.ts";
import type { RecordAction } from "./record-actions.tsx";
import { useInitiativeChange } from "./use-initiative-change.ts";

/**
 * Plan with…: a new planning Thread on the Initiative where the Planner waits for the user's first
 * message on how to plan it, auto mode off. The Initiative's conversation then opens on that Thread.
 */
function usePlanningWith(initiative: Initiative): UseMutationResult<Initiative, Error, void> {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const planner = usePlanner()?.card.name ?? "Whoever holds Plans";
  return useInitiativeChange(
    initiative,
    () => planInitiativeWith(initiative.id),
    (planning) => {
      void queryClient.invalidateQueries(threadQueries.onInitiative(initiative.id));
      showToast(planningWithWords(planner));
      if (planning.planningThreadId === null) return;
      void navigate({
        to: "/work/initiatives/$initiativeId",
        params: { initiativeId: initiative.id },
        search: { initiativeThread: planning.planningThreadId },
        resetScroll: false,
      });
    },
  );
}

export function planningWithWords(planner: string): string {
  return `${planner} waits for your message: say how to plan the Initiative's Tasks in Backlog. Auto mode is off: you confirm each one as it is planned.`;
}

/**
 * "Plan with Jan" beside Plan the Initiative, offered as it is: on an active Initiative with a Task
 * in Backlog, while someone is the Planner.
 */
export function usePlanWithAction(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): RecordAction | undefined {
  const planner = usePlanner()?.card.name;
  const showToast = useToast();
  const planning = usePlanningWith(initiative);
  if (!planner || !canPlanInitiative(initiative, initiativeTasks)) return undefined;
  return {
    key: "plan-initiative-with",
    label: `Plan with ${planner}`,
    icon: "message-circle",
    variant: "secondary",
    hint: `Open a planning Thread where ${planner} waits for you to say how to plan it`,
    pending: planning.isPending,
    onSelect: () => planning.mutate(undefined, { onError: (error) => showToast(error.message) }),
  };
}

/** The Planner's empty tab's way to start planning, while Plan with… is offered. */
export function PlanInitiativeWith({
  initiative,
  planner,
}: {
  readonly initiative: Initiative;
  readonly planner: string;
}): ReactNode {
  const showToast = useToast();
  const tasks = useEveryTask().data ?? [];
  const planning = usePlanningWith(initiative);
  if (!canPlanInitiative(initiative, tasksOfInitiative(initiative, tasks))) return null;
  return (
    <div className="task-conversation-start">
      <Button
        variant="secondary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={planning.isPending}
        onClick={() => planning.mutate(undefined, { onError: (error) => showToast(error.message) })}
      >
        Plan with {planner}
      </Button>
    </div>
  );
}
