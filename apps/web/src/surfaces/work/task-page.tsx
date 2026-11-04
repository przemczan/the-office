import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { Pipeline, Project, Task, Thread } from "@the-office/contracts";
import { Icon, Tabs } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries, taskQueries } from "../../api/work.ts";
import { stoppedAtCurrentStage } from "./stage-rail-words.ts";
import { pipelineLabel, REMOVED_PIPELINE, taskTokens } from "./stage-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { AttachmentsBlock } from "./attachments-block.tsx";
import { ConversationDrawerProvider } from "./conversation-drawer.tsx";
import { MissingRecord } from "./missing-record.tsx";
import { PipelineRail } from "./pipeline-rail.tsx";
import { NeedsYouCard } from "./needs-you-card.tsx";
import { MarkReadyButton, PlanButton } from "./planning-actions.tsx";
import { PullRequestButton } from "./pull-request-button.tsx";
import { RECORD_ELEMENT_ID, recordTabOf, type RecordTab } from "./record-tab.ts";
import { RunControls } from "./run-controls.tsx";
import { focusStage } from "./stage-selection.ts";
import { StartButton } from "./start-action.tsx";
import { ChangesTab } from "./task-changes.tsx";
import { TaskConversation } from "./task-conversation.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { TaskRecord } from "./task-record.tsx";
import { TaskTags } from "./task-tags.tsx";
import { TokenCount, TokenMeter } from "../../shell/token-count.tsx";

/**
 * The Task page (prototypes/app/task.js): its head, Pipeline rail and Needs you card across the
 * page, then its record on the left, as Overview, Changes or Attachments, and its conversation on
 * the right.
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
      <TaskBody
        key={record.id}
        task={record}
        pipeline={pipeline}
        threads={threads.data}
        taskThread={taskThread}
        recordTab={recordTab}
      />
    </div>
  );
}

/**
 * All under the head, keyed by Task: what it holds, such as the rail's selection, means nothing on
 * the next one, where the same Pipeline's Stages have the same keys.
 */
function TaskBody({
  task,
  pipeline,
  threads,
  taskThread,
  recordTab,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  readonly threads: readonly Thread[] | undefined;
  readonly taskThread: string | undefined;
  readonly recordTab: RecordTab | undefined;
}): ReactNode {
  const [selectedStageKey, setSelectedStageKey] = useState<string>();
  return (
    <ConversationDrawerProvider>
      <PipelineRail
        task={task}
        pipeline={pipeline}
        selectedKey={selectedStageKey}
        onSelect={setSelectedStageKey}
      />
      <NeedsYouCard task={task} pipeline={pipeline} />
      <div className="task-columns">
        <div className="task-record-column" id={RECORD_ELEMENT_ID}>
          <RecordTabs task={task} shown={recordTab} />
          <RecordTabContent task={task} shown={recordTab} />
        </div>
        <TaskConversation
          task={task}
          threads={threads}
          asked={taskThread}
          onShowStage={(stageKey) => {
            setSelectedStageKey(stageKey);
            focusStage(stageKey);
          }}
        />
      </div>
    </ConversationDrawerProvider>
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
        <div className="task-head-crumb">
          <ProjectChip projectId={task.projectId} projects={projects} />
        </div>
        <div className="task-head-title">
          <h2>{task.title}</h2>
          <TaskStateBadge
            state={task.state}
            pausedByAlarm={task.pausedByAlarm}
            stopped={stoppedAtCurrentStage(taskStages?.stages ?? [])}
          />
          {waitingOnYou(task) && <TaskStateBadge state="waiting-on-you" />}
        </div>
        <div className="task-head-meta">
          <span className="task-head-priority">
            <Icon name="flag" size={12} />
            {PRIORITY_NAMES[task.priority]} priority
          </span>
          <span>
            Pipeline <b>{pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, editedForTask)}</b>
          </span>
          {task.estimatedTokens === null ? (
            <TokenCount tokens={tokens} label="tokens" />
          ) : (
            <TokenMeter tokens={tokens} estimatedTokens={task.estimatedTokens} />
          )}
          <TaskTags task={task} />
        </div>
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
  shown,
}: {
  readonly task: Task;
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
      return <TaskRecord task={task} />;
  }
}
