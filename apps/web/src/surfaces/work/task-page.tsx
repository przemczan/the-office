import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import type { Pipeline, Project, Task, Thread } from "@the-office/contracts";
import { EmptyState } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { taskTokens } from "./stage-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { MarkReadyButton, PlanButton } from "./planning-actions.tsx";
import { StartButton } from "./start-action.tsx";
import { TaskConversation } from "./task-conversation.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { TaskRecord } from "./task-record.tsx";

/**
 * The Task page (prototypes/app/task.js): its record on the left, its conversation on the right.
 * The Changes tab comes with Gates and Publish (task 14).
 */
export function TaskPage(): ReactNode {
  const { taskId } = useParams({ from: "/tasks/$taskId" });
  const { taskThread } = useSearch({ from: "/tasks/$taskId" });
  const task = useQuery(taskQueries.one(taskId));
  const projects = useQuery(projectQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const threads = useQuery(threadQueries.onTask(taskId));
  usePageHeading({
    title: task.data?.title ?? "Work",
    parent: { label: "Work", to: "/work" },
    crumb: task.data?.title,
  });
  if (task.error) return <Missing error={task.error} />;
  const record = task.data;
  if (!record) return null;
  const pipeline = pipelines.data?.find(({ id }) => id === record.pipelineId);
  return (
    <div className="task-page">
      <TaskHead task={record} projects={projects.data} pipeline={pipeline} threads={threads.data} />
      <div className="task-columns">
        <TaskRecord task={record} pipeline={pipeline} />
        <TaskConversation task={record} threads={threads.data} shownFirst={taskThread} />
      </div>
    </div>
  );
}

function TaskHead({
  task,
  projects,
  pipeline,
  threads,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  readonly pipeline: Pipeline | undefined;
  readonly threads: readonly Thread[] | undefined;
}): ReactNode {
  const tokens = taskTokens(threads);
  const waitingOnYou = useWaitingOnYouInItsState();
  return (
    <header className="task-head">
      <div className="task-head-grow">
        <h2>{task.title}</h2>
        <div className="task-head-meta">
          <TaskStateBadge state={task.state} />
          {waitingOnYou(task) && <TaskStateBadge state="waiting-on-you" />}
          <ProjectChip projectId={task.projectId} projects={projects} />
          <span>· Pipeline {pipeline?.name ?? task.pipelineId}</span>
          <span>· {PRIORITY_NAMES[task.priority]} priority</span>
          <span>· {tokensShort(tokens)} tokens</span>
        </div>
      </div>
      <div className="task-head-actions">
        <PlanButton task={task} variant="primary" />
        <MarkReadyButton task={task} />
        <StartButton task={task} />
        <TaskMenu task={task} />
      </div>
    </header>
  );
}

function Missing({ error }: { readonly error: Error }): ReactNode {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <div className="task-page">
      <EmptyState
        icon={gone ? "file-x" : "circle-alert"}
        title={gone ? error.message : "The Task can't be shown."}
        description={gone ? undefined : error.message}
        action={<Link to="/work">Back to Work</Link>}
      />
    </div>
  );
}
