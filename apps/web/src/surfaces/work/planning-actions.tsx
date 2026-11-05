import type { Task } from "@the-office/contracts";
import { Button, Icon, type ButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import {
  useMakingAPlan,
  useMarkingReady,
  usePlanning,
  useReadyConditionsMet,
} from "./use-planning.ts";

/**
 * "Plan with Jan" on a Task in Backlog, or `label` where the place says less; nothing while nobody
 * is the Planner, as planning would be refused.
 */
export function PlanButton({
  task,
  label,
  variant = "secondary",
  size,
}: {
  readonly task: Task;
  readonly label?: string;
  readonly variant?: ButtonProps["variant"];
  readonly size?: ButtonProps["size"];
}): ReactNode {
  const planner = usePlanner();
  const planning = usePlanning();
  if (!planner || task.state !== "backlog") return null;
  return (
    <Button
      variant={variant}
      size={size}
      iconLeft={<Icon name="map" size={14} />}
      loading={planning.isPending}
      onClick={() => planning.mutate(task)}
    >
      {label ?? `Plan with ${planner.card.name}`}
    </Button>
  );
}

/**
 * Make a plan on a Task in Backlog: the Planner plans from the title and the Description at once.
 * Nothing while nobody is the Planner, as planning would be refused.
 */
export function MakeAPlanButton({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner();
  const making = useMakingAPlan();
  if (!planner || task.state !== "backlog") return null;
  return (
    <Button
      variant="primary"
      iconLeft={<Icon name="map" size={14} />}
      loading={making.isPending}
      onClick={() => making.mutate(task)}
    >
      Make a plan
    </Button>
  );
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
