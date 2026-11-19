import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, PullRequest, Task } from "@the-office/contracts";
import { Alert, Badge, Button, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { pullRequestQueries, refreshPullRequests } from "../../api/pull-requests.ts";
import { taskQueries } from "../../api/work.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { GitHubPermissionsPrompt } from "../../shell/github-permissions-prompt.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  branchWords,
  CHECKS_WORDS,
  checkedWords,
  IN_OTHER_PROJECTS,
  MERGEABLE_WORDS,
  NO_PULL_REQUESTS,
  OUT_OF_DATE,
  OUT_OF_DATE_TITLE,
  problemTitle,
  problemWords,
  pullRequestName,
  REFRESH_HINT,
  TASK_NOT_FOUND,
  type ToneWords,
} from "./pull-request-words.ts";

/**
 * Work › Pull requests: the open pull requests The Office opened, in the Projects the Project
 * filter shows, each with its Task, its checks and whether it merges, as the service last read them
 * from the code host; Refresh asks for a read now, and `pull-requests.changed` brings what it found.
 */
export function PullRequestsPage(): ReactNode {
  const list = useQuery(pullRequestQueries.list());
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const projectFilter = useProjectFilter();
  const refreshing = useMutation({ mutationFn: refreshPullRequests });
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
      {list.error && <Alert tone="danger" title={list.error.message} />}
      {!list.data && !list.error && <BlockLoader shape="rows" label="Loading pull requests…" />}
      {list.data && (
        <>
          <InOtherProjectsNote count={elsewhere} {...IN_OTHER_PROJECTS} />
          <DataTable
            columns={columnsFor(projects.data, tasks.data)}
            rows={[...shown]}
            empty={NO_PULL_REQUESTS}
          />
        </>
      )}
    </div>
  );
}

function projectNameOf(projectId: string, projects: readonly Project[] | undefined): string {
  return projects?.find((project) => project.id === projectId)?.name ?? projectId;
}

function columnsFor(
  projects: readonly Project[] | undefined,
  tasks: readonly Task[] | undefined,
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
  ];
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

function ToneBadge({ words }: { readonly words: ToneWords }): ReactNode {
  return (
    <span title={words.title}>
      <Badge tone={words.tone} dot size="sm">
        {words.label}
      </Badge>
    </span>
  );
}
