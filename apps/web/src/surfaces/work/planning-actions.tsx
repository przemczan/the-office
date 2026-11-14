import type { Task } from "@the-office/contracts";
import { Button, Icon, IconButton, Switch, Tooltip } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import {
  useMakingAPlan,
  useMarkingReady,
  usePlanning,
  useReadyConditionsMet,
  useRememberedAutoMode,
} from "./use-planning.ts";

/**
 * "Plan with Jan" on a Task in Backlog: opens the planning Thread for the user to talk it through
 * first. Nothing while nobody is the Planner, as planning would be refused.
 */
export function PlanButton({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner();
  const planning = usePlanning();
  if (!planner || task.state !== "backlog") return null;
  return (
    <Button
      variant="secondary"
      iconLeft={<Icon name="map" size={14} />}
      loading={planning.isPending}
      onClick={() => planning.mutate(task)}
    >
      Plan with {planner.card.name}
    </Button>
  );
}

/**
 * Make a plan on a Task in Backlog, beside its Auto mode switch: the Planner plans from the title
 * and the Description at once. The switch starts at the remembered default, and the choice made
 * with Make a plan becomes it. Nothing while nobody is the Planner, as planning would be refused.
 */
export function MakeAPlan({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner();
  const making = useMakingAPlan();
  const remembered = useRememberedAutoMode();
  const [chosen, setChosen] = useState<boolean>();
  if (!planner || task.state !== "backlog") return null;
  const autoMode = chosen ?? remembered;
  return (
    <div className="make-a-plan">
      <Button
        variant="primary"
        iconLeft={<Icon name="map" size={14} />}
        loading={making.isPending}
        onClick={() => making.mutate({ task, autoMode })}
      >
        Make a plan
      </Button>
      <Switch checked={autoMode} onChange={setChosen} label="Auto mode" />
    </div>
  );
}

/**
 * The board card's Plan, an icon: as Make a plan, in the remembered auto mode, which its tooltip
 * names, as a card has no room for the switch.
 */
export function PlanOnCardButton({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner();
  const making = useMakingAPlan();
  const autoMode = useRememberedAutoMode();
  if (!planner || task.state !== "backlog") return null;
  return (
    <Tooltip
      content={
        autoMode
          ? `Plan: ${planner.card.name} makes a plan in auto mode: the Task is marked Ready without your Confirm.`
          : `Plan: ${planner.card.name} makes a plan for you to confirm. Auto mode is off.`
      }
    >
      <IconButton
        variant="secondary"
        size="xs"
        icon={<Icon name="map" size={13} />}
        label="Plan"
        // The tooltip names it, rather than the browser's own title.
        title={undefined}
        disabled={making.isPending}
        onClick={() => making.mutate({ task, autoMode })}
      />
    </Tooltip>
  );
}

/** "Planning with Angela", and "in auto mode" when the Task won't wait for the user's Confirm. */
export function planningNoteWords(task: Task, planner: string | undefined): string {
  const planning = `Planning with ${planner ?? "whoever holds Plans"}`;
  return task.autoMode ? `${planning}, in auto mode` : planning;
}

/**
 * Mark Ready: on a Task in Planning, disabled until every line of its "Before Ready" checklist is
 * met (Before Ready says which are not); in Backlog, where the user wrote the parts without
 * Planning, only once every line is met.
 */
export function MarkReadyButton({ task }: { readonly task: Task }): ReactNode {
  const marking = useMarkingReady();
  const conditionsMet = useReadyConditionsMet(task);
  if (task.state !== "planning" && !(task.state === "backlog" && conditionsMet)) return null;
  return (
    <Button
      variant="primary"
      disabled={!conditionsMet}
      iconLeft={<Icon name="check" size={14} />}
      loading={marking.isPending}
      onClick={() => marking.mutate(task)}
    >
      Mark Ready
    </Button>
  );
}
