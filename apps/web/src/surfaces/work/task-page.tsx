import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { Pipeline, Project, Task, Thread } from "@the-office/contracts";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { pipelineLabel, REMOVED_PIPELINE, taskTokens } from "./stage-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { MissingRecord } from "./missing-record.tsx";
import { MarkReadyButton, PlanButton } from "./planning-actions.tsx";
import { RunControls } from "./run-controls.tsx";
import { StartButton } from "./start-action.tsx";
import { ChangesTab } from "./task-changes.tsx";
import { TaskConversation } from "./task-conversation.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { TaskRecord } from "./task-record.tsx";
import { TaskTags } from "./task-tags.tsx";

/**
 * The Task page (prototypes/app/task.js): its record on the left, as an overview or its Changes,
 * and its conversation on the right.
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
      <div className="task-columns">
        <div className="task-record-column">
          <RecordTabs task={record} shown={recordTab} />
          {recordTab === "changes" ? (
            <section className="task-record" aria-label="Changes">
              <ChangesTab task={record} />
            </section>
          ) : (
            <TaskRecord task={record} pipeline={pipeline} />
          )}
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
  const editedForTask = useQuery(pipelineQueries.taskStages(task.id)).data?.editedForTask ?? false;
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
          {task.initiativeId !== null && <InitiativeLink initiativeId={task.initiativeId} />}
          <span>· {tokensShort(tokens)} tokens</span>
        </div>
        <TaskTags task={task} />
      </div>
      <div className="task-head-actions">
        <PlanButton task={task} variant="primary" />
        <MarkReadyButton task={task} />
        <StartButton task={task} />
        <RunControls task={task} />
        <TaskMenu task={task} />
      </div>
    </header>
  );
}

/** The Initiative the Task is part of, by its name now. */
function InitiativeLink({ initiativeId }: { readonly initiativeId: string }): ReactNode {
  const name = useQuery(initiativeQueries.one(initiativeId)).data?.name;
  if (name === undefined) return null;
  return (
    <Link to="/work/initiatives/$initiativeId" params={{ initiativeId }}>
      · Initiative {name}
    </Link>
  );
}

/** Overview and Changes, with how many files the Task changed. */
function RecordTabs({
  task,
  shown,
}: {
  readonly task: Task;
  readonly shown: "changes" | undefined;
}): ReactNode {
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const changedFiles = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data?.files;
  return (
    <Tabs
      tabs={[
        { value: "overview", label: "Overview" },
        {
          value: "changes",
          label: "Changes",
          ...(changedFiles && changedFiles.length > 0 && { count: changedFiles.length }),
        },
      ]}
      value={shown ?? "overview"}
      onChange={(value) =>
        void navigate({
          search: (search) => ({
            ...search,
            recordTab: value === "changes" ? "changes" : undefined,
          }),
        })
      }
    />
  );
}
