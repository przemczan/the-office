import type { Initiative, ReadyTasksStarted, Task } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu, Switch, type MenuItem } from "@the-office/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import {
  autoModeQuery,
  confirmInitiative,
  ideaQueries,
  planInitiative,
  taskQueries,
} from "../../api/work.ts";
import { useCopyRecordLink } from "../../shell/copy-record-link.ts";
import { useToast } from "../../shell/toasts.tsx";
import { NewTaskDialog } from "../../shell/work/new-task-dialog.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { canBeArchived } from "../../shell/work/work-words.ts";
import { canHoldBack } from "./dependency-words.ts";
import { InitiativePauseButton } from "./initiative-pause.tsx";
import { canPlanInitiative } from "./initiative-planning-words.ts";
import { DropInitiativeDialog } from "./drop-initiative-dialog.tsx";
import { AddExistingTaskDialog } from "./initiative-membership.tsx";
import { tasksToAdd } from "./initiative-membership-words.ts";
import { tasksOfInitiative } from "./initiative-words.ts";
import { useArchivingInitiative } from "./use-initiative-archive.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import { StartReadyTasksButton } from "./start-ready-tasks.tsx";
import { useRememberedAutoMode } from "./use-planning.ts";

/**
 * The Initiative page's head actions (prototypes/app/work.js `initiativePage`): "Confirm the
 * Initiative" while shaping, Plan the Initiative while it is active with a Task in Backlog, the
 * link to its planning Thread once it has one, Start Ready Tasks while it is active with a Ready
 * Task, its answer going to `onStartedReadyTasks`, Pause the Initiative while it is active and
 * Resume the Initiative while it is paused, "Add a Task" while it is open (in the Project of
 * the Idea it was shaped from, if any, until it has Tasks) and "Add an existing Task" beside it,
 * one in no Initiative, and its menu with
 * Drop until it has ended, asking first in DropInitiativeDialog, Archive once it has.
 */
export function InitiativeActions({
  initiative,
  onStartedReadyTasks,
}: {
  readonly initiative: Initiative;
  readonly onStartedReadyTasks: (started: ReadyTasksStarted) => void;
}): ReactNode {
  const [adding, setAdding] = useState<"new" | "existing">();
  const tasks = useQuery(taskQueries.list());
  const originIdea = useQuery({
    ...ideaQueries.one(initiative.originIdeaId ?? ""),
    enabled: initiative.originIdeaId !== null,
  });
  const open = initiative.state === "shaping" || initiative.state === "active";
  const initiativeTasks = tasksOfInitiative(initiative, tasks.data ?? []);
  return (
    <>
      {initiative.state === "shaping" && <ConfirmButton initiative={initiative} />}
      <PlanningThreadLink initiative={initiative} />
      <PlanTheInitiative initiative={initiative} initiativeTasks={initiativeTasks} />
      <StartReadyTasksButton
        initiative={initiative}
        initiativeTasks={initiativeTasks}
        onStarted={onStartedReadyTasks}
      />
      <InitiativePauseButton initiative={initiative} />
      {open && (
        <>
          <Button
            variant="secondary"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() => setAdding("new")}
          >
            Add a Task
          </Button>
          <Button variant="secondary" onClick={() => setAdding("existing")}>
            Add an existing Task
          </Button>
        </>
      )}
      <InitiativeMenu initiative={initiative} initiativeTasks={initiativeTasks} />
      {adding === "new" && (
        <NewTaskDialog
          initiative={initiative}
          projectId={originIdea.data?.projectId}
          canWaitFor={initiativeTasks.filter(canHoldBack)}
          onClose={() => setAdding(undefined)}
        />
      )}
      {adding === "existing" && (
        <AddExistingTaskDialog
          initiative={initiative}
          candidates={tasksToAdd(initiative, tasks.data ?? [])}
          onClose={() => setAdding(undefined)}
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
      showToast(plannedWords(planner ?? "Whoever holds Plans", planned.planningAutoMode));
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

function InitiativeMenu({
  initiative,
  initiativeTasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const copyLink = useCopyRecordLink();
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
      onSelect: () => setDropping(true),
    });
  }
  return (
    <>
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
      {dropping && (
        <DropInitiativeDialog
          initiative={initiative}
          initiativeTasks={initiativeTasks}
          onClose={() => setDropping(false)}
        />
      )}
    </>
  );
}
