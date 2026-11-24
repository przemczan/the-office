import type { Initiative, ReadyTasksStarted, TaskSummary } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu, Switch, type MenuItem } from "@the-office/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import {
  autoModeQuery,
  confirmInitiative,
  ideaQueries,
  planInitiative,
  useEveryTask,
} from "../../api/work.ts";
import { useCopyRecordLink } from "../../shell/copy-record-link.ts";
import { useToast } from "../../shell/toasts.tsx";
import { NewTaskDialog } from "../../shell/work/new-task-dialog.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { canBeArchived } from "../../shell/work/work-words.ts";
import { canHoldBack } from "../../shell/work/initiative-progress.ts";
import { useBrowseInitiativeFilesActions } from "./browse-files.tsx";
import { useRestoreInitiativeAction } from "./archive-parts.tsx";
import { useBackToShapingAction } from "./initiative-back-to-shaping.tsx";
import { useInitiativePauseAction } from "./initiative-pause.tsx";
import { usePlanWithAction, useStillPlanningReason } from "./initiative-plan-with.tsx";
import { canPlanInitiative } from "./initiative-planning-words.ts";
import { DropInitiativeDialog } from "./drop-initiative-dialog.tsx";
import { AddExistingTaskDialog } from "./initiative-membership.tsx";
import { tasksToAdd } from "./initiative-membership-words.ts";
import { tasksOfInitiative } from "./initiative-words.ts";
import { useArchivingInitiative } from "./use-initiative-archive.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import {
  actionToneClassName,
  RecordActions,
  withActionItems,
  type RecordAction,
} from "./record-actions.tsx";
import { useStartReadyTasksAction } from "./start-ready-tasks.tsx";
import { useRememberedAutoMode } from "./use-planning.ts";

/**
 * The Initiative page's head actions (prototypes/app/work.js `initiativePage`): "Confirm the
 * Initiative" while shaping, Plan the Initiative and Plan with… while it is active with a Task in
 * Backlog, the link to its planning Thread once it has one, Start Ready Tasks while it is active
 * with a Ready Task, its answer going to `onStartedReadyTasks`, Pause the Initiative while it is
 * active and Resume the Initiative while it is paused, "Add a Task" while it is open (in the
 * Project of the Idea it was shaped from, if any, until it has Tasks) and "Add an existing Task"
 * beside it, one in no Initiative, Browse files for each Project where its branch is known here,
 * Back to Shaping while it is active, asking first (the user's alone, no Agent's), and Restore
 * while it is archived; then its menu, with each of
 * these and Copy link, Drop until it has ended, asking first in DropInitiativeDialog, and Archive
 * once it has.
 */
export function InitiativeActions({
  initiative,
  onStartedReadyTasks,
  className,
}: {
  readonly initiative: Initiative;
  readonly onStartedReadyTasks: (started: ReadyTasksStarted) => void;
  readonly className?: string;
}): ReactNode {
  const [adding, setAdding] = useState<"new" | "existing">();
  const tasks = useEveryTask();
  const originIdea = useQuery({
    ...ideaQueries.one(initiative.originIdeaId ?? ""),
    enabled: initiative.originIdeaId !== null,
  });
  const open = initiative.state === "shaping" || initiative.state === "active";
  const initiativeTasks = tasksOfInitiative(initiative, tasks.data ?? []);
  const confirm = useConfirmAction(initiative);
  const planningThread = usePlanningThreadAction(initiative);
  const plan = usePlanTheInitiativeAction(initiative, initiativeTasks);
  const planWith = usePlanWithAction(initiative, initiativeTasks);
  const startReadyTasks = useStartReadyTasksAction(
    initiative,
    initiativeTasks,
    onStartedReadyTasks,
  );
  const pause = useInitiativePauseAction(initiative);
  const backToShaping = useBackToShapingAction(initiative, initiativeTasks);
  const restore = useRestoreInitiativeAction(initiative);
  const browseFiles = useBrowseInitiativeFilesActions(initiative);
  const actions = [
    confirm,
    planningThread,
    plan,
    planWith,
    startReadyTasks,
    pause,
    ...(open ? addingActions(setAdding) : []),
    ...browseFiles,
    // Last of the row, so this rare step is the first left to the More menu when space runs out.
    backToShaping,
    restore,
  ].filter((action) => action !== undefined);
  return (
    <>
      <RecordActions
        actions={actions}
        {...(className && { className })}
        menu={
          <InitiativeMenu
            initiative={initiative}
            initiativeTasks={initiativeTasks}
            actions={actions}
          />
        }
      />
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

/** Add a Task and Add an existing Task, each opening its window. */
function addingActions(setAdding: (adding: "new" | "existing") => void): RecordAction[] {
  return [
    { key: "add-task", label: "Add a Task", icon: "plus", onSelect: () => setAdding("new") },
    {
      key: "add-existing-task",
      label: "Add an existing Task",
      icon: "list-plus",
      onSelect: () => setAdding("existing"),
    },
  ];
}

/** Confirm the Initiative, while it is shaping. */
function useConfirmAction(initiative: Initiative): RecordAction | undefined {
  const showToast = useToast();
  const planner = usePlanner()?.card.name;
  const confirming = useInitiativeChange(
    initiative,
    () => confirmInitiative(initiative.id),
    (confirmed) => showToast(confirmedWords(confirmed, planner)),
  );
  if (initiative.state !== "shaping") return undefined;
  return {
    key: "confirm",
    label: "Confirm the Initiative",
    icon: "check",
    tone: "go",
    variant: "primary",
    pending: confirming.isPending,
    onSelect: () => confirming.mutate(undefined, { onError: (error) => showToast(error.message) }),
  };
}

/**
 * Plan the Initiative, beside its Auto mode switch: one planning Thread with the Planner, who plans
 * its Backlog Tasks in their dependency order. The switch starts at the remembered default, which
 * the choice becomes, as with Make a plan; from the More menu it plans as the switch stands. None
 * while nobody is the Planner; disabled, saying why, while the latest planning Thread's person is
 * answering there.
 */
export function usePlanTheInitiativeAction(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): RecordAction | undefined {
  const planner = usePlanner()?.card.name;
  const showToast = useToast();
  const queryClient = useQueryClient();
  const remembered = useRememberedAutoMode();
  const [chosen, setChosen] = useState<boolean>();
  const autoMode = chosen ?? remembered;
  const stillPlanning = useStillPlanningReason(initiative, planner);
  const planning = useInitiativeChange(
    initiative,
    (inAutoMode: boolean) => planInitiative(initiative.id, inAutoMode),
    (planned) => {
      queryClient.setQueryData(autoModeQuery().queryKey, { autoMode: planned.planningAutoMode });
      void queryClient.invalidateQueries(threadQueries.onInitiative(initiative.id));
      showToast(plannedWords(planner ?? "Whoever holds Plans", planned.planningAutoMode));
    },
  );
  if (!planner || !canPlanInitiative(initiative, initiativeTasks)) return undefined;
  const plan = (): void =>
    planning.mutate(autoMode, { onError: (error) => showToast(error.message) });
  return {
    key: "plan-the-initiative",
    label: "Plan the Initiative",
    icon: "map",
    tone: "plan",
    variant: "primary",
    pending: planning.isPending,
    disabled: stillPlanning !== undefined,
    ...(stillPlanning !== undefined && { hint: stillPlanning }),
    onSelect: plan,
    control: (
      <div className="make-a-plan">
        <Button
          variant="primary"
          className={actionToneClassName("plan", "primary")}
          iconLeft={<Icon name="map" size={14} />}
          loading={planning.isPending}
          disabled={stillPlanning !== undefined}
          title={stillPlanning}
          onClick={plan}
        >
          Plan the Initiative
        </Button>
        <Switch checked={autoMode} onChange={setChosen} label="Auto mode" />
      </div>
    ),
  };
}

function plannedWords(planner: string, autoMode: boolean): string {
  const planning = `${planner} is planning the Initiative's Tasks in Backlog, in their dependency order`;
  return autoMode
    ? `${planning}, in auto mode: each is marked Ready once planned.`
    : `${planning}. You confirm each one as it is planned.`;
}

/** The way to the Initiative's latest planning Thread, once it has one, in its conversation. */
function usePlanningThreadAction(initiative: Initiative): RecordAction | undefined {
  const navigate = useNavigate();
  const threadId = initiative.planningThreadId;
  if (threadId === null) return undefined;
  const to = {
    to: "/work/initiatives/$initiativeId",
    params: { initiativeId: initiative.id },
    search: { initiativeThread: threadId },
    resetScroll: false,
  } as const;
  return {
    key: "planning-thread",
    label: "Planning Thread",
    icon: "messages-square",
    tone: "plan",
    onSelect: () => void navigate(to),
    control: (
      <Link className={`link-button ${actionToneClassName("plan", "secondary")}`} {...to}>
        Planning Thread
      </Link>
    ),
  };
}

function confirmedWords(confirmed: Initiative, planner: string | undefined): string {
  if (confirmed.state === "done") return "Initiative confirmed, and done: its Tasks are.";
  const until = planner ? `${planner} plans them` : "they are planned";
  return `Initiative confirmed. Its Tasks moved to Backlog, to wait until ${until}.`;
}

function InitiativeMenu({
  initiative,
  initiativeTasks,
  actions,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly TaskSummary[];
  readonly actions: readonly RecordAction[];
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
        width={220}
        trigger={
          <IconButton
            variant="secondary"
            icon={<Icon name="ellipsis" size={14} />}
            label={`More for ${initiative.name}`}
          />
        }
        items={withActionItems(actions, items)}
      />
      {actions.map(
        (action) => action.dialog && <Fragment key={action.key}>{action.dialog}</Fragment>,
      )}
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
