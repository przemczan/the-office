import type { Initiative, Task } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu, Switch, type MenuItem } from "@the-office/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import {
  autoModeQuery,
  confirmInitiative,
  dropInitiative,
  planInitiative,
  taskQueries,
} from "../../api/work.ts";
import { useCopyRecordLink } from "../../shell/copy-record-link.ts";
import { useToast } from "../../shell/toasts.tsx";
import { NewTaskDialog } from "../../shell/work/new-task-dialog.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { canBeArchived } from "../../shell/work/work-words.ts";
import { canHoldBack } from "./dependency-words.ts";
import { canPlanInitiative } from "./initiative-planning-words.ts";
import { droppedWords, tasksOfInitiative } from "./initiative-words.ts";
import { useArchivingInitiative } from "./use-initiative-archive.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import { useRememberedAutoMode } from "./use-planning.ts";

/**
 * The Initiative page's head actions (prototypes/app/work.js `initiativePage`): "Confirm the
 * Initiative" while shaping, Plan the Initiative while it is active with a Task in Backlog, the
 * link to its planning Thread once it has one, "Add a Task" while it is open, and its menu with
 * Drop until it has ended, Archive once it has.
 */
export function InitiativeActions({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [adding, setAdding] = useState(false);
  const tasks = useQuery(taskQueries.list());
  const open = initiative.state === "shaping" || initiative.state === "active";
  const initiativeTasks = tasksOfInitiative(initiative, tasks.data ?? []);
  return (
    <>
      {initiative.state === "shaping" && <ConfirmButton initiative={initiative} />}
      <PlanningThreadLink initiative={initiative} />
      <PlanTheInitiative initiative={initiative} initiativeTasks={initiativeTasks} />
      {open && (
        <Button
          variant="secondary"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={() => setAdding(true)}
        >
          Add a Task
        </Button>
      )}
      <InitiativeMenu initiative={initiative} />
      {adding && (
        <NewTaskDialog
          initiative={initiative}
          canWaitFor={initiativeTasks.filter(canHoldBack)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

function ConfirmButton({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const showToast = useToast();
  const planner = usePlanner()?.card.name;
  const confirming = useInitiativeChange(
    initiative,
    () => confirmInitiative(initiative.id),
    (confirmed) => showToast(confirmedWords(confirmed, planner)),
  );
  return (
    <Button
      iconLeft={<Icon name="check" size={14} />}
      loading={confirming.isPending}
      onClick={() => confirming.mutate(undefined, { onError: (error) => showToast(error.message) })}
    >
      Confirm the Initiative
    </Button>
  );
}

/**
 * Plan the Initiative, beside its Auto mode switch: one planning Thread with the Planner, who plans
 * its Backlog Tasks in their dependency order. The switch starts at the remembered default, which
 * the choice becomes, as with Make a plan. Nothing while nobody is the Planner.
 */
export function PlanTheInitiative({
  initiative,
  initiativeTasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
}): ReactNode {
  const planner = usePlanner()?.card.name;
  const showToast = useToast();
  const queryClient = useQueryClient();
  const remembered = useRememberedAutoMode();
  const [chosen, setChosen] = useState<boolean>();
  const autoMode = chosen ?? remembered;
  const planning = useInitiativeChange(
    initiative,
    (inAutoMode: boolean) => planInitiative(initiative.id, inAutoMode),
    (planned) => {
      queryClient.setQueryData(autoModeQuery().queryKey, { autoMode: planned.planningAutoMode });
      void queryClient.invalidateQueries(threadQueries.onInitiative(initiative.id));
      showToast(plannedWords(planner ?? "The Planner", planned.planningAutoMode));
    },
  );
  if (!planner || !canPlanInitiative(initiative, initiativeTasks)) return null;
  return (
    <div className="make-a-plan">
      <Button
        variant="primary"
        iconLeft={<Icon name="map" size={14} />}
        loading={planning.isPending}
        onClick={() => planning.mutate(autoMode, { onError: (error) => showToast(error.message) })}
      >
        Plan the Initiative
      </Button>
      <Switch checked={autoMode} onChange={setChosen} label="Auto mode" />
    </div>
  );
}

function plannedWords(planner: string, autoMode: boolean): string {
  const planning = `${planner} is planning the Initiative's Tasks in Backlog, in their dependency order`;
  return autoMode
    ? `${planning}, in auto mode: each is marked Ready once planned.`
    : `${planning}. You confirm each one as it is planned.`;
}

/** The way to the Initiative's latest planning Thread, once it has one, in its conversation. */
function PlanningThreadLink({ initiative }: { readonly initiative: Initiative }): ReactNode {
  if (initiative.planningThreadId === null) return null;
  return (
    <Link
      className="link-button"
      to="/work/initiatives/$initiativeId"
      params={{ initiativeId: initiative.id }}
      search={{ initiativeThread: initiative.planningThreadId }}
      resetScroll={false}
    >
      Planning Thread
    </Link>
  );
}

function confirmedWords(confirmed: Initiative, planner: string | undefined): string {
  if (confirmed.state === "done") return "Initiative confirmed, and done: its Tasks are.";
  const until = planner ? `${planner} plans them` : "they are planned";
  return `Initiative confirmed. Its Tasks moved to Backlog, to wait until ${until}.`;
}

function InitiativeMenu({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [open, setOpen] = useState(false);
  const copyLink = useCopyRecordLink();
  const showToast = useToast();
  const dropping = useInitiativeChange(initiative, () => dropInitiative(initiative.id));
  const archiving = useArchivingInitiative();
  const items: MenuItem[] = [
    {
      icon: <Icon name="link" size={14} />,
      label: "Copy link",
      onSelect: () => copyLink({ kind: "initiative", initiativeId: initiative.id }),
    },
  ];
  if (canBeArchived(initiative)) {
    items.push({
      icon: <Icon name="archive" size={14} />,
      label: "Archive",
      onSelect: () => archiving.mutate(initiative),
    });
  }
  if (initiative.state === "shaping" || initiative.state === "active") {
    items.push({
      icon: <Icon name="x" size={14} />,
      label: "Drop the Initiative",
      danger: true,
      onSelect: () => {
        // Read now: the state changes under the mutation, as the Initiative's event lands first.
        const words = droppedWords(initiative.state);
        dropping.mutate(undefined, {
          onSuccess: () => showToast(words),
          onError: (error) => showToast(error.message),
        });
      },
    });
  }
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={200}
      trigger={
        <IconButton
          variant="secondary"
          icon={<Icon name="ellipsis" size={14} />}
          label={`More for ${initiative.name}`}
        />
      }
      items={items}
    />
  );
}
