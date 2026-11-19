import type { Readiness, Task } from "@the-office/contracts";
import { Button, Dialog, Icon, IconButton, Switch, Tooltip } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import type { RecordAction } from "./record-actions.tsx";
import {
  useMakingAPlan,
  useMarkingReady,
  usePlanning,
  useReadinessLines,
  useRememberedAutoMode,
} from "./use-planning.ts";

/** What moves a Task along in planning, Plan with and Mark Ready, each while it is offered. */
export function usePlanningActions(task: Task): RecordAction[] {
  return [usePlanWithAction(task), useMarkReadyAction(task)].filter(
    (action) => action !== undefined,
  );
}

/**
 * "Plan with Jan" on a Task in Backlog: opens the planning Thread for the user to talk it through
 * first. None while nobody is the Planner, as planning would be refused.
 */
function usePlanWithAction(task: Task): RecordAction | undefined {
  const planner = usePlanner();
  const planning = usePlanning();
  if (!planner || task.state !== "backlog") return undefined;
  return {
    key: "plan-with",
    label: `Plan with ${planner.card.name}`,
    icon: "map",
    pending: planning.isPending,
    onSelect: () => planning.mutate(task),
  };
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
 * Mark Ready: in Planning and in Backlog, once a Pipeline is chosen and no Decision is open; in
 * Planning it shows disabled until then (Before Ready says why). With every line of "Before Ready"
 * met it marks the Task Ready at once; with the Plan or the Definition of Done not confirmed yet,
 * it asks first (`MarkReadyAnywayDialog`), and Mark Ready anyway confirms them as they stand.
 */
function useMarkReadyAction(task: Task): RecordAction | undefined {
  const marking = useMarkingReady();
  const lines = useReadinessLines(task);
  const [asking, setAsking] = useState(false);
  const offered = lines !== undefined && markReadyOffered(lines);
  if (task.state !== "planning" && !(task.state === "backlog" && offered)) return undefined;
  const unconfirmed = lines ? unconfirmedWords(task, lines) : [];
  return {
    key: "mark-ready",
    label: "Mark Ready",
    icon: "check",
    variant: "primary",
    disabled: !offered,
    pending: marking.isPending,
    onSelect: () => {
      if (unconfirmed.length > 0) setAsking(true);
      else marking.mutate({ task });
    },
    ...(asking && {
      dialog: (
        <MarkReadyAnywayDialog
          task={task}
          unconfirmed={unconfirmed}
          pending={marking.isPending}
          onMarkReady={() =>
            marking.mutate(
              { task, confirmPlanAndDefinitionOfDone: true },
              { onSettled: () => setAsking(false) },
            )
          }
          onClose={() => setAsking(false)}
        />
      ),
    }),
  };
}

/** Mark Ready is offered once a Pipeline is chosen and no Decision is open. */
function markReadyOffered(lines: Readiness["lines"]): boolean {
  return lines
    .filter(({ part }) => part === "pipeline" || part === "decisions")
    .every(({ met }) => met);
}

/**
 * What Mark Ready anyway confirms as it stands, one sentence for each of the Plan and the
 * Definition of Done whose line isn't met: not written when it is empty, else not confirmed.
 */
export function unconfirmedWords(task: Task, lines: Readiness["lines"]): string[] {
  const unmet = new Set(lines.filter(({ met }) => !met).map(({ part }) => part));
  const words: string[] = [];
  if (unmet.has("plan"))
    words.push(task.plan.trim() === "" ? "The Plan isn't written." : "The Plan isn't confirmed.");
  if (unmet.has("definition-of-done"))
    words.push(
      task.definitionOfDone.length === 0
        ? "The Definition of Done isn't written."
        : "The Definition of Done isn't confirmed.",
    );
  return words;
}

/** Asks before marking Ready a Task whose Plan or Definition of Done isn't confirmed. */
function MarkReadyAnywayDialog({
  task,
  unconfirmed,
  pending,
  onMarkReady,
  onClose,
}: {
  readonly task: Task;
  readonly unconfirmed: readonly string[];
  readonly pending: boolean;
  readonly onMarkReady: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      size="small"
      title={`Mark ${task.title} Ready?`}
      onClose={onClose}
      actions={
        <Button variant="primary" loading={pending} onClick={onMarkReady}>
          Mark Ready anyway
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{unconfirmed.join(" ")}</p>
        <p className="dialog-text">
          Marking it Ready confirms the Plan and the Definition of Done as they stand.
        </p>
      </div>
    </Dialog>
  );
}
