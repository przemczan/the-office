import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { Pipeline, Project, Task, Thread } from "@the-office/contracts";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries, taskQueries } from "../../api/work.ts";
import { pipelineLabel, REMOVED_PIPELINE, taskTokens } from "./stage-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { AttachmentsBlock } from "./attachments-block.tsx";
import { MissingRecord } from "./missing-record.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";
import { MarkReadyButton, PlanButton } from "./planning-actions.tsx";
import { PullRequestButton } from "./pull-request-button.tsx";
import { recordTabOf, type RecordTab } from "./record-tab.ts";
import { RunControls } from "./run-controls.tsx";
import { StartButton } from "./start-action.tsx";
import { ChangesTab } from "./task-changes.tsx";
import { TaskConversation } from "./task-conversation.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { TaskRecord } from "./task-record.tsx";
import { TaskTags } from "./task-tags.tsx";
import { TokenCount, TokenMeter } from "../../shell/token-count.tsx";

/**
 * The Task page (prototypes/app/task.js): its head and Pipeline rail across the page, then its
 * record on the left, as Overview, Changes or Attachments, and its conversation on the right.
 */
export function TaskPage(): ReactNode {
  const { taskId } = useParams({ from: "/tasks/$taskId" });
  const { taskThread, recordTab } = useSearch({ from: "/tasks/$taskId" });
  const task = useQuery(taskQueries.one(taskId));
  const projects = useQuery(projectQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const threads = useQuery(threadQueries.onTask(taskId));
  usePageHeading({
    title: task.data?.title ?? "Work",
    parent: { label: "Work", to: "/work" },
    crumb: task.data?.title,
  });
  if (task.error) return <MissingRecord error={task.error} kind="Task" />;
  const record = task.data;
  // Without the library a Pipeline it doesn't have would read as removed.
  if (!record || !pipelines.data) return null;
  const pipeline = pipelines.data.find(({ id }) => id === record.pipelineId);
  return (
    <div className="task-page">
      <TaskHead task={record} projects={projects.data} pipeline={pipeline} threads={threads.data} />
      <PipelineRail key={record.id} task={record} pipeline={pipeline} />
      <div className="task-columns">
        <div className="task-record-column">
          <RecordTabs task={record} shown={recordTab} />
          <RecordTabContent task={record} pipeline={pipeline} shown={recordTab} />
        </div>
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
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const editedForTask = taskStages?.editedForTask ?? false;
  const waitingOnYou = useWaitingOnYouInItsState();
  return (
    <header className="task-head">
      <div className="task-head-grow">
        <h2>{task.title}</h2>
        <div className="task-head-meta">
          <TaskStateBadge state={task.state} pausedByAlarm={task.pausedByAlarm} />
          {waitingOnYou(task) && <TaskStateBadge state="waiting-on-you" />}
          <ProjectChip projectId={task.projectId} projects={projects} />
          <span>· Pipeline {pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, editedForTask)}</span>
          <span>· {PRIORITY_NAMES[task.priority]} priority</span>
          <span>
            ·{" "}
            {task.estimatedTokens === null ? (
              <TokenCount tokens={tokens} label="tokens" />
            ) : (
              <TokenMeter tokens={tokens} estimatedTokens={task.estimatedTokens} />
            )}
          </span>
        </div>
        <TaskTags task={task} />
      </div>
      <div className="task-head-actions">
        <PlanButton task={task} variant="primary" />
        <MarkReadyButton task={task} />
        <StartButton task={task} />
        <RunControls task={task} />
        <PullRequestButton taskStages={taskStages?.stages} />
        <TaskMenu task={task} />
      </div>
    </header>
  );
}

/** Overview, Changes and Attachments, with how many files the Task changed and it holds. */
function RecordTabs({
  task,
  shown,
}: {
  readonly task: Task;
  readonly shown: RecordTab | undefined;
}): ReactNode {
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const changedFiles = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data?.files;
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId: task.id })).data;
  return (
    <Tabs
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "changes", label: "Changes", ...countOf(changedFiles) },
        { value: "attachments", label: "Attachments", ...countOf(attachments) },
      ]}
      value={shown ?? "overview"}
      onChange={(value) =>
        void navigate({ search: (search) => ({ ...search, recordTab: recordTabOf(value) }) })
      }
    />
  );
}

/** A tab's count, left out until there is something to count. */
function countOf(items: readonly unknown[] | undefined): { readonly count?: number } {
  return items && items.length > 0 ? { count: items.length } : {};
}

function RecordTabContent({
  task,
  pipeline,
  shown,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  readonly shown: RecordTab | undefined;
}): ReactNode {
  switch (shown) {
    case "changes":
      return (
        <section className="task-record" aria-label="Changes">
          <ChangesTab task={task} />
        </section>
      );
    case "attachments":
      return (
        <div className="task-record">
          <AttachmentsBlock owner={{ kind: "task", taskId: task.id }} ownerTitle={task.title} />
        </div>
      );
    case undefined:
      return <TaskRecord task={task} pipeline={pipeline} />;
  }
}
