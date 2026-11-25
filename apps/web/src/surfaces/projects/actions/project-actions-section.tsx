import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type {
  Action,
  ActionRun,
  ProjectActionRuns,
  Project,
  Proposal,
} from "@the-office/contracts";
import { Badge, Button, Card, Dialog, Icon, PickList, PickListItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { actionRunQueries } from "../../../api/action-runs.ts";
import { actionQueries, useSaveActions } from "../../../api/actions.ts";
import { ciRunQueries } from "../../../api/ci-runs.ts";
import { deviceQueries } from "../../../api/devices.ts";
import { proposalQueries } from "../../../api/conversations.ts";
import { projectQueries } from "../../../api/projects.ts";
import { ACTION_KIND_LABELS } from "../../../shell/action-words.ts";
import { AskDevopsButton, useDevops } from "../../../shell/ask-devops.tsx";
import { ProposalCard } from "../../../shell/conversation/proposal-card.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { useSignedInUserId } from "../../../shell/use-user-name.ts";
import { useOpenProject } from "../project-page.tsx";
import { ActionEditorDialog } from "./action-editor-dialog.tsx";
import { ActionHistory } from "./action-history.tsx";
import { ActionRunLogWindow } from "./action-run-log-window.tsx";
import { ActionRunStateBadge, RunActionButton } from "./action-run-parts.tsx";
import {
  isRunning,
  lastRunLine,
  lastRunOf,
  removeRunningWords,
  runsOf,
} from "./action-run-words.ts";
import {
  ActionRunsLine,
  ActionTools,
  ActionWarnings,
  LeavesTheWorkstationBadge,
} from "./action-parts.tsx";
import {
  actionSetByWords,
  actionsWith,
  actionWarnings,
  type ActionContext,
} from "./action-words.ts";
import { RunWindow } from "./run-window.tsx";
import "./project-actions.css";

/** What the editor has open: an Action by its key, or a new one. */
type Editing = { readonly key: string } | "new";

/**
 * A Project's Actions section (spec: project-page.md, "Actions"): the list on the left, Devops'
 * open Proposal of them above it, and the open Action's History on the right, laid out as Pipelines
 * are. `?run=<id>` on an open Action opens that run's log.
 */
export function ProjectActionsSection(): ReactNode {
  const project = useOpenProject();
  const { actionKey } = useParams({ strict: false });
  const { run: shownRunId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const read = useQuery(actionQueries.list(project.id));
  const runsRead = useQuery(actionRunQueries.ofProject(project.id));
  const runs = runsRead.data;
  const [editing, setEditing] = useState<Editing>();
  const [running, setRunning] = useState<string>();
  const [removingRunning, setRemovingRunning] = useState<Action>();
  const context = useActionContext(project, read.data?.actions);
  const removing = useRemoveAction(project, actionKey);
  if (read.error) {
    return <RefusalAlert title={`${project.name}'s Actions can't be read`} error={read.error} />;
  }
  if (!read.data) return null;
  const { actions } = read.data;
  const open = actions.find(({ key }) => key === actionKey);
  const listName = `${project.name}'s Actions`;
  const remove = (action: Action): void => {
    removing.reset();
    const last = lastRunOf(runs, action.key);
    if (last !== undefined && isRunning(last)) setRemovingRunning(action);
    else removing.mutate({ actions, removed: action });
  };
  const tools = (action: Action): ReactNode => (
    <ActionTools
      action={action}
      before={
        <RunActionButton
          action={action}
          runEnvironment={project.runEnvironment}
          lastRun={lastRunOf(runs, action.key)}
          onRun={() => setRunning(action.key)}
        />
      }
      disabled={removing.isPending}
      onChange={() => {
        removing.reset();
        setEditing({ key: action.key });
      }}
      onRemove={() => remove(action)}
    />
  );
  const openRuns = open === undefined ? [] : runsOf(runs, open.key);
  const shownRun = openRuns.find(({ id }) => id === shownRunId);
  const showRun = (run: ActionRun | undefined): void => {
    if (open === undefined) return;
    void navigate({
      to: "/projects/$projectId/actions/$actionKey",
      params: { projectId: project.id, actionKey: open.key },
      search: run === undefined ? {} : { run: run.id },
      replace: run === undefined,
    });
  };
  const runWindowFor = actions.find(({ key }) => key === running);
  const edited =
    typeof editing === "object" ? actions.find(({ key }) => key === editing.key) : undefined;
  return (
    <div className={actionKey === undefined ? "project-actions" : "project-actions showing-detail"}>
      <div className="project-actions-list">
        <OpenProposals projectId={project.id} />
        <ActionList
          project={project}
          actions={actions}
          runs={runs}
          open={open}
          context={context}
          tools={tools}
          onAdd={() => {
            removing.reset();
            setEditing("new");
          }}
        />
        {removing.error && !removingRunning && (
          <RefusalAlert title="Nothing was removed" error={removing.error} />
        )}
      </div>
      <div className="project-actions-detail">
        <Link
          className="project-actions-back"
          to="/projects/$projectId/actions"
          params={{ projectId: project.id }}
        >
          <Icon name="chevron-left" size={14} />
          {listName}
        </Link>
        {open ? (
          <>
            <OpenAction project={project} action={open} context={context} tools={tools(open)} />
            {runsRead.error && (
              <RefusalAlert title={`${open.name}'s runs can't be read`} error={runsRead.error} />
            )}
            {runs !== undefined && (
              <ActionHistory
                projectId={project.id}
                runs={openRuns}
                shownRunId={shownRunId}
                onOpenRun={showRun}
              />
            )}
          </>
        ) : (
          <Card>
            <p className="project-block-text">
              {actionKey === undefined
                ? "Open an Action to see its runs."
                : `${project.name} has no such Action: it may have been removed.`}
            </p>
          </Card>
        )}
      </div>
      {runWindowFor && (
        <RunWindow project={project} action={runWindowFor} onClose={() => setRunning(undefined)} />
      )}
      {shownRun && <ActionRunLogWindow run={shownRun} onClose={() => showRun(undefined)} />}
      {removingRunning && (
        <Dialog
          size="small"
          title={`Remove ${removingRunning.name}`}
          onClose={() => setRemovingRunning(undefined)}
          actions={
            <Button
              variant="danger"
              loading={removing.isPending}
              onClick={() =>
                removing.mutate({ actions, removed: removingRunning }, () =>
                  setRemovingRunning(undefined),
                )
              }
            >
              Remove
            </Button>
          }
        >
          <p className="project-block-text">{removeRunningWords(removingRunning.name)}</p>
          {removing.error && <RefusalAlert title="Nothing was removed" error={removing.error} />}
        </Dialog>
      )}
      {editing !== undefined && (editing === "new" || edited) && (
        <ActionEditorDialog
          project={project}
          actions={actions}
          action={edited}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/**
 * What the Actions' warnings are read against: the Project's test targets, its devices, and the
 * workflows on its base branch, each read only while one of its Actions names one.
 */
function useActionContext(project: Project, actions: readonly Action[] | undefined): ActionContext {
  const targets = useQuery({
    ...projectQueries.testTargets(project.id),
    enabled: actions?.some(({ kind }) => kind === "test-target") ?? false,
  });
  const devices = useQuery({
    ...deviceQueries.ofProject(project.id),
    enabled:
      actions?.some(
        (action) => action.kind === "project-command" && action.settings.projectDeviceId !== null,
      ) ?? false,
  });
  const workflows = useQuery({
    ...ciRunQueries.workflows(project.id, project.baseBranch),
    enabled: actions?.some(({ kind }) => kind === "workflow") ?? false,
  });
  return {
    project,
    targets: targets.data?.targets,
    devices: devices.data?.devices,
    workflows: workflows.data,
  };
}

/** Removing an Action at once, saved with the whole list; back to the list when it was open. */
function useRemoveAction(project: Project, openKey: string | undefined) {
  const saving = useSaveActions(project.id);
  const showToast = useToast();
  const navigate = useNavigate();
  return {
    isPending: saving.isPending,
    error: saving.error,
    reset: saving.reset,
    mutate: (
      {
        actions,
        removed,
      }: {
        readonly actions: readonly Action[];
        readonly removed: Action;
      },
      onRemoved?: () => void,
    ) =>
      saving.mutate(
        { actions: actionsWith(actions, { removedKey: removed.key }) },
        {
          onSuccess: () => {
            onRemoved?.();
            showToast(`${removed.name} removed.`);
            if (openKey === removed.key) {
              void navigate({
                to: "/projects/$projectId/actions",
                params: { projectId: project.id },
              });
            }
          },
        },
      ),
  };
}

function ActionList({
  project,
  actions,
  runs,
  open,
  context,
  tools,
  onAdd,
}: {
  readonly project: Project;
  readonly actions: readonly Action[];
  readonly runs: ProjectActionRuns | undefined;
  readonly open: Action | undefined;
  readonly context: ActionContext;
  readonly tools: (action: Action) => ReactNode;
  readonly onAdd: () => void;
}): ReactNode {
  const devops = useDevops();
  const devopsName = devops?.card.name ?? "Devops";
  const head = (
    <>
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Icon name="plus" size={14} />}
        onClick={onAdd}
      >
        Add an Action
      </Button>
      <AskDevopsButton
        label={(name) => `Ask ${name} to propose Actions`}
        draft={`Can you propose Actions for ${project.name}? `}
      />
    </>
  );
  return (
    <div className="actions-list">
      <PickList
        name={`${project.name}'s Actions`}
        count={actions.length}
        action={head}
        empty={`No Actions yet. Add one, such as an install on a phone or a release, or have ${devopsName} propose them from the repository.`}
        note="Things to run on demand, outside the Task queue. Kept in The Office, never in the repository."
      >
        {actions.map((action) => (
          <ActionItem
            key={action.key}
            project={project}
            action={action}
            lastRun={lastRunOf(runs, action.key)}
            runsRead={runs !== undefined}
            picked={action.key === open?.key}
            context={context}
            tools={tools(action)}
          />
        ))}
      </PickList>
    </div>
  );
}

function ActionItem({
  project,
  action,
  lastRun,
  runsRead,
  picked,
  context,
  tools,
}: {
  readonly project: Project;
  readonly action: Action;
  /** Undefined before its first, or while the runs are read. */
  readonly lastRun: ActionRun | undefined;
  readonly runsRead: boolean;
  readonly picked: boolean;
  readonly context: ActionContext;
  readonly tools: ReactNode;
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  const setBy = actionSetByWords(action, signedInUserId);
  const warnings = actionWarnings(action, context);
  return (
    <PickListItem
      picked={picked}
      name={
        <span className="action-name">
          {action.name}
          <Badge mono size="sm">
            {action.key}
          </Badge>
          {/* On the name line, which wraps, so the kind line beside the tools keeps its width. */}
          {action.leavesTheWorkstation && (
            <LeavesTheWorkstationBadge baseBranch={project.baseBranch} />
          )}
        </span>
      }
      line={<ActionRunsLine action={action} targets={context.targets} />}
      secondLine={
        [lastRun === undefined ? undefined : lastRunLine(lastRun), setBy]
          .filter((part) => part !== undefined)
          .join(" · ") || undefined
      }
      aside={runsRead ? <ActionRunStateBadge run={lastRun} /> : undefined}
      renderLink={(parts) => (
        <>
          <Link
            to="/projects/$projectId/actions/$actionKey"
            params={{ projectId: project.id, actionKey: action.key }}
            {...parts}
          />
          {tools}
          <ActionWarnings project={project} action={action} warnings={warnings} />
        </>
      )}
    />
  );
}

/**
 * The open Action's head card: its name, key and kind, what it runs, whether it leaves the
 * workstation and who set it, with its pencil and trash.
 */
function OpenAction({
  project,
  action,
  context,
  tools,
}: {
  readonly project: Project;
  readonly action: Action;
  readonly context: ActionContext;
  readonly tools: ReactNode;
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  const setBy = actionSetByWords(action, signedInUserId);
  return (
    <Card
      title={
        <span className="action-name">
          {action.name}
          <Badge mono size="sm">
            {action.key}
          </Badge>
          <Badge size="sm">{ACTION_KIND_LABELS[action.kind]}</Badge>
          {action.leavesTheWorkstation && (
            <LeavesTheWorkstationBadge baseBranch={project.baseBranch} />
          )}
        </span>
      }
      actions={tools}
    >
      <div className="open-action">
        <span className="open-action-runs">
          <ActionRunsLine action={action} targets={context.targets} />
        </span>
        {setBy !== undefined && <span className="test-target-set-by">{setBy}</span>}
        <ActionWarnings
          project={project}
          action={action}
          warnings={actionWarnings(action, context)}
        />
      </div>
    </Card>
  );
}

/** Devops' open Proposals of this Project's Actions, each as its card in the chat. */
function OpenProposals({ projectId }: { readonly projectId: string }): ReactNode {
  const open = useQuery(proposalQueries.open()).data ?? [];
  const shown = open.filter(
    ({ change }: Proposal) => change.kind === "actions" && change.projectId === projectId,
  );
  if (shown.length === 0) return null;
  return (
    <div className="actions-proposals">
      {shown.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}
