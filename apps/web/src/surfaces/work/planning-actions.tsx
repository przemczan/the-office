import type { Task } from "@the-office/contracts";
import { Button, Icon, type ButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { useMarkingReady, usePlanning } from "./use-planning.ts";

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
 * Mark Ready on a Task in Planning. It is offered before the Plan and the Definition of Done are
 * confirmed, while a Pipeline proposal is open and while a Decision waits on the user too, and
 * refused then with the reasons, so the user learns what is missing.
 */
export function MarkReadyButton({ task }: { readonly task: Task }): ReactNode {
  const marking = useMarkingReady();
  const waitingOnYou = useWaitingOnYouInItsState();
  if (task.state !== "planning") return null;
  const confirmed =
    task.planConfirmed &&
    task.definitionOfDoneConfirmed &&
    task.proposedPipeline === null &&
    !waitingOnYou(task);
  return (
    <Button
      variant={confirmed ? "primary" : "secondary"}
      iconLeft={<Icon name="check" size={14} />}
      loading={marking.isPending}
      onClick={() => marking.mutate(task)}
    >
      Mark Ready
    </Button>
  );
}
