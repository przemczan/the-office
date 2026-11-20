import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ConflictResolutionAnswer, Project, PullRequest, Task } from "@the-office/contracts";
import { Alert, Badge, Button, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { pullRequestQueries, refreshPullRequests } from "../../api/pull-requests.ts";
import { resolveConflicts, taskQueries } from "../../api/work.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { GitHubPermissionsPrompt } from "../../shell/github-permissions-prompt.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { ClosePullRequestDialog } from "./close-pull-request-dialog.tsx";
import { TaskWithState } from "./conflict-resolution-parts.tsx";
import {
  openConflictResolutionOf,
  queuedWords,
  RESOLVE_CONFLICTS_ACTION,
  RESOLVE_CONFLICTS_TITLE,
  resolveRefusedTitle,
  RESOLVING,
  START_REFUSED_HINT,
  START_REFUSED_TITLE,
} from "./conflict-resolution-words.ts";
import { MergePullRequestDialog } from "./merge-pull-request-dialog.tsx";
import { ToneBadge } from "./pull-request-parts.tsx";
import {
  branchWords,
  CHECKS_WORDS,
  CLOSE_ACTION,
  checkedWords,
  IN_OTHER_PROJECTS,
  MERGE_ACTION,
  MERGEABLE_WORDS,
  NO_PULL_REQUESTS,
  OUT_OF_DATE,
  OUT_OF_DATE_TITLE,
  problemTitle,
  problemWords,
  pullRequestName,
  REFRESH_HINT,
  TASK_NOT_FOUND,
} from "./pull-request-words.ts";

/**
 * Work › Pull requests: the open pull requests The Office opened, in the Projects the Project
 * filter shows, each with its Task, its checks and whether it merges, as the service last read them
 * from the code host; Refresh asks for a read now, and `pull-requests.changed` brings what it found.
 * Each row's Merge… and Close… open their windows; one merged or closed leaves the list. A row with
 * conflicts offers Resolve conflicts, which makes and starts a Conflict resolution Task, and shows
 * that Task instead while it is open.
 */
export function PullRequestsPage(): ReactNode {
  const list = useQuery(pullRequestQueries.list());
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const projectFilter = useProjectFilter();
  const refreshing = useMutation({ mutationFn: refreshPullRequests });
  const [acting, setActing] = useState<Acting | undefined>();
  const resolving = useResolving();
  // The answer's Task shows at once, before the Tasks are read again.
  const known = withTask(tasks.data, resolving.data?.task);
  const { shown, elsewhere } = narrowed(list.data?.pullRequests ?? [], (pullRequest) =>
    projectFilter.shows([pullRequest.projectId]),
  );
  const problems = (list.data?.problems ?? []).filter((problem) =>
    projectFilter.shows([problem.projectId]),
  );
  return (
    <div className="pull-requests-page">
      <GitHubPermissionsPrompt />
      <div className="pull-requests-head">
        <span className="pull-requests-hint">{REFRESH_HINT}</span>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="refresh-cw" size={14} />}
          loading={refreshing.isPending}
          onClick={() => refreshing.mutate()}
        >
          Refresh
        </Button>
      </div>
      {refreshing.error && (
        <RefusalAlert title="The pull requests weren't refreshed" error={refreshing.error} />
      )}
      {problems.map((problem) => (
        <Alert
          key={problem.projectId}
          tone="warning"
          title={problemTitle(projectNameOf(problem.projectId, projects.data))}
        >
          {problemWords(problem)}
        </Alert>
      ))}
      <ResolvingOutcome resolving={resolving} />
      {list.error && <Alert tone="danger" title={list.error.message} />}
      {!list.data && !list.error && <BlockLoader shape="rows" label="Loading pull requests…" />}
      {list.data && (
        <>
          <InOtherProjectsNote count={elsewhere} {...IN_OTHER_PROJECTS} />
          <DataTable
            columns={columnsFor(projects.data, known, setActing, resolving)}
            rows={[...shown]}
            empty={NO_PULL_REQUESTS}
          />
        </>
      )}
      {acting && (
        <ActingDialog acting={acting} shown={shown} onClose={() => setActing(undefined)} />
      )}
    </div>
  );
}

/** The window a row's action opened, on the pull request it was opened on. */
interface Acting {
  readonly action: "merge" | "close";
  readonly pullRequest: PullRequest;
}

/** The window, showing the pull request as last read, or as it was opened on once it left the list. */
function ActingDialog({
  acting,
  shown,
  onClose,
}: {
  readonly acting: Acting;
  readonly shown: readonly PullRequest[];
  readonly onClose: () => void;
}): ReactNode {
  const pullRequest = shown.find(({ id }) => id === acting.pullRequest.id) ?? acting.pullRequest;
  return acting.action === "merge" ? (
    <MergePullRequestDialog pullRequest={pullRequest} onClose={onClose} />
  ) : (
    <ClosePullRequestDialog pullRequest={pullRequest} onClose={onClose} />
  );
}

type Resolving = ReturnType<typeof useResolving>;

/** Resolve conflicts on a row's pull request; the answer and any refusal show above the list. */
function useResolving() {
  const queryClient = useQueryClient();
  return useMutation<ConflictResolutionAnswer, Error, PullRequest>({
    mutationFn: (pullRequest) => resolveConflicts(pullRequest.taskId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(taskQueries.list()),
        queryClient.invalidateQueries(taskQueries.queue()),
      ]),
  });
}

/** The Tasks as read, with `task` added until they include it; their copy is the newer one. */
function withTask(
  tasks: readonly Task[] | undefined,
  task: Task | undefined,
): readonly Task[] | undefined {
  if (tasks === undefined || task === undefined) return tasks;
  return tasks.some(({ id }) => id === task.id) ? tasks : [...tasks, task];
}

/**
 * What the last Resolve conflicts came to, when the user needs to know: refused with its reasons,
 * the Task made but left Ready by Start's reasons, or queued for Start.
 */
function ResolvingOutcome({ resolving }: { readonly resolving: Resolving }): ReactNode {
  const pullRequest = resolving.variables;
  if (pullRequest === undefined) return null;
  if (resolving.error) {
    return (
      <RefusalAlert
        title={resolveRefusedTitle(pullRequest)}
        error={resolving.error}
        action={
          <Button variant="ghost" size="sm" onClick={() => resolving.reset()}>
            Dismiss
          </Button>
        }
      />
    );
  }
  const answer = resolving.data;
  if (answer === undefined) return null;
  if (answer.startRefusal !== null) {
    return (
      <Alert tone="warning" title={START_REFUSED_TITLE} onClose={() => resolving.reset()}>
        <ul className="refusal-reasons">
          {answer.startRefusal.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p>
          <TaskWithState task={answer.task} />. {START_REFUSED_HINT}
        </p>
      </Alert>
    );
  }
  if (answer.queued !== null) {
    return (
      <Alert tone="info" onClose={() => resolving.reset()}>
        {queuedWords(answer.task, answer.queued)}
      </Alert>
    );
  }
  return null;
}

function projectNameOf(projectId: string, projects: readonly Project[] | undefined): string {
  return projects?.find((project) => project.id === projectId)?.name ?? projectId;
}

function columnsFor(
  projects: readonly Project[] | undefined,
  tasks: readonly Task[] | undefined,
  act: (acting: Acting) => void,
  resolving: Resolving,
): DataTableColumn<PullRequest>[] {
  return [
    {
      key: "pullRequest",
      header: "Pull request",
      wrap: true,
      render: (pullRequest) => (
        <a
          className="pull-request-link"
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pullRequestName(pullRequest)}
          <Icon name="external-link" size={12} />
        </a>
      ),
    },
    {
      key: "task",
      header: "Task",
      wrap: true,
      render: (pullRequest) => <TaskCell taskId={pullRequest.taskId} tasks={tasks} />,
    },
    {
      key: "project",
      header: "Project",
      render: (pullRequest) => (
        <ProjectChip projectId={pullRequest.projectId} projects={projects} />
      ),
    },
    {
      key: "branch",
      header: "Branch",
      mono: true,
      wrap: true,
      render: (pullRequest) => branchWords(pullRequest),
    },
    {
      key: "checks",
      header: "Checks",
      render: ({ checks }) => <ToneBadge words={CHECKS_WORDS[checks]} />,
    },
    {
      key: "mergeable",
      header: "Mergeable",
      render: ({ mergeable }) => <ToneBadge words={MERGEABLE_WORDS[mergeable]} />,
    },
    {
      key: "checked",
      header: "Checked",
      muted: true,
      render: (pullRequest) => (
        <span className="pull-request-checked">
          {checkedWords(pullRequest.checkedAt)}
          {pullRequest.stale && (
            <span title={OUT_OF_DATE_TITLE}>
              <Badge tone="warning" size="sm">
                {OUT_OF_DATE}
              </Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (pullRequest) => (
        <span className="pull-request-actions">
          <ResolveConflicts pullRequest={pullRequest} tasks={tasks} resolving={resolving} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => act({ action: "merge", pullRequest })}
          >
            {MERGE_ACTION}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => act({ action: "close", pullRequest })}>
            {CLOSE_ACTION}
          </Button>
        </span>
      ),
    },
  ];
}

/**
 * On a row with conflicts: Resolve conflicts, or while its Task has an open Conflict resolution Task,
 * that Task with its state.
 */
function ResolveConflicts({
  pullRequest,
  tasks,
  resolving,
}: {
  readonly pullRequest: PullRequest;
  readonly tasks: readonly Task[] | undefined;
  readonly resolving: Resolving;
}): ReactNode {
  const open = openConflictResolutionOf(pullRequest.taskId, tasks ?? []);
  if (open) {
    return (
      <span className="pull-request-resolving">
        {RESOLVING} <TaskWithState task={open} />
      </span>
    );
  }
  if (pullRequest.mergeable !== "conflicts") return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      title={RESOLVE_CONFLICTS_TITLE}
      loading={resolving.isPending && resolving.variables?.id === pullRequest.id}
      onClick={() => resolving.mutate(pullRequest)}
    >
      {RESOLVE_CONFLICTS_ACTION}
    </Button>
  );
}

function TaskCell({
  taskId,
  tasks,
}: {
  readonly taskId: string;
  readonly tasks: readonly Task[] | undefined;
}): ReactNode {
  if (tasks === undefined) return null;
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return <span className="pull-request-no-task">{TASK_NOT_FOUND}</span>;
  return (
    <Link to="/tasks/$taskId" params={{ taskId }} className="pull-request-task">
      {task.title}
    </Link>
  );
}
