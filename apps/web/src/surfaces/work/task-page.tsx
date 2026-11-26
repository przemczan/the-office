import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { Pipeline, Project, Task, Thread } from "@the-office/contracts";
import { Badge, Skeleton, Tabs, Tooltip } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { BlockLoader, type BlockRead } from "../../shell/block-loader.tsx";
import { useEveryPipelineRead } from "../../shell/pipelines/use-pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries, taskQueries } from "../../api/work.ts";
import { stoppedAtCurrentStage } from "./stage-rail-words.ts";
import {
  engineStandInsReasons,
  engineStandInsShown,
  engineStandInsWords,
  PIPELINE_NOT_CHOSEN,
  pipelineLabel,
  REMOVED_PIPELINE,
  taskTokens,
} from "./stage-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { KindGlyph, PriorityGlyph, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { DropNote } from "./drop-note.tsx";
import { OffBoardTaskBadge } from "../../shell/work/off-board-task-badge.tsx";
import { OffBoardTaskNote } from "./off-board-task-note.tsx";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { KIND_NAMES, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { ArchivedBadge } from "./archive-parts.tsx";
import { AttachmentsBlock } from "./attachments-block.tsx";
import { ConversationDrawerProvider } from "./conversation-drawer.tsx";
import { MissingRecord } from "./missing-record.tsx";
import { PipelineDiagramWindow } from "./pipeline-diagram-window.tsx";
import { OPEN_DIAGRAM_BUTTON_ID, PipelineRail, RailLoader } from "./pipeline-rail.tsx";
import { NeedsYouCard } from "./needs-you-card.tsx";
import { RecordActions } from "./record-actions.tsx";
import { TaskEngineBlock } from "./work-engine-block.tsx";
import { RECORD_ELEMENT_ID, recordTabOf, type RecordTab } from "../../shell/work/record-tab.ts";
import { useStageHistory } from "./use-stage-history.ts";
import { StartNotes } from "./start-action.tsx";
import { useTaskActions } from "./task-actions.ts";
import { ChangesTab } from "./task-changes.tsx";
import { TaskConversation } from "./task-conversation.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { TaskRecord } from "./task-record.tsx";
import { TaskTitle } from "./task-title.tsx";
import { TaskTags } from "./task-tags.tsx";
import { TokenCount, TokenMeter } from "../../shell/token-count.tsx";
import { WorkTabs } from "./work-tabs.tsx";

/**
 * The Task page (prototypes/app/task.js): its head, Pipeline rail and Needs you card across the
 * page, then its record on the left, as Overview, Changes or Attachments, and its conversation on
 * the right.
 */
export function TaskPage(): ReactNode {
  const { taskId } = useParams({ from: "/tasks/$taskId" });
  const { taskThread, decision, recordTab } = useSearch({ from: "/tasks/$taskId" });
  const task = useQuery(taskQueries.one(taskId));
  const projects = useQuery(projectQueries.list());
  const { pipelines, reads: pipelineReads } = useEveryPipelineRead();
  const threads = useQuery(threadQueries.onTask(taskId));
  usePageHeading({
    title: task.data?.title ?? "Work",
    parent: { label: "Work", to: "/work" },
    crumb: task.data?.title,
  });
  if (task.error) return <MissingRecord error={task.error} kind="Task" />;
  const record = task.data;
  // Without the Pipelines a Pipeline they don't have would read as removed.
  if (!record || !pipelines) {
    return (
      <div className="task-page">
        <WorkTabs shown="tasks" />
        <TaskPageLoader pipelineReads={pipelineReads} />
      </div>
    );
  }
  const pipeline = pipelines.find(({ id }) => id === record.pipelineId);
  return (
    // The tabs stay inside the page's first element, which the conversation's fit watches.
    <div className="task-page">
      <WorkTabs shown="tasks" />
      <TaskHead task={record} projects={projects.data} pipeline={pipeline} threads={threads.data} />
      <TaskBody
        key={record.id}
        task={record}
        pipeline={pipeline}
        taskThread={taskThread}
        decisionId={decision}
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
  taskThread,
  decisionId,
  recordTab,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  readonly taskThread: string | undefined;
  readonly decisionId: string | undefined;
  readonly recordTab: RecordTab | undefined;
}): ReactNode {
  const stageHistory = useStageHistory(task.id, taskThread, decisionId);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const closeDiagram = (): void => {
    setDiagramOpen(false);
    document.getElementById(OPEN_DIAGRAM_BUTTON_ID)?.focus();
  };
  return (
    <ConversationDrawerProvider onLinkToDecisionCard={stageHistory.hide}>
      <PipelineRail
        task={task}
        pipeline={pipeline}
        shown={stageHistory.shown}
        onSelect={stageHistory.show}
        onCloseHistory={stageHistory.close}
        onOpenDiagram={() => setDiagramOpen(true)}
      />
      {diagramOpen && (
        <PipelineDiagramWindow
          task={task}
          pipeline={pipeline}
          onOpenStageHistory={(stageKey) => {
            setDiagramOpen(false);
            stageHistory.show(stageKey);
          }}
          onClose={closeDiagram}
        />
      )}
      <div className="task-columns">
        <div className="task-record-column">
          <NeedsYouCard task={task} />
          <div id={RECORD_ELEMENT_ID} className="task-record-tabs">
            <RecordTabs task={task} shown={recordTab} />
          </div>
          <RecordTabContent task={task} shown={recordTab} />
        </div>
        <TaskConversation
          task={task}
          onShowStage={stageHistory.show}
          asked={stageHistory.askedThread}
        />
      </div>
    </ConversationDrawerProvider>
  );
}

/**
 * The page's frame until the Task and the Pipelines are read, shaped as the page: the head, the
 * rail, the record beside the conversation. The Task's own failure shows as MissingRecord instead.
 */
function TaskPageLoader({
  pipelineReads,
}: {
  readonly pipelineReads: readonly BlockRead[];
}): ReactNode {
  return (
    <>
      {/* Part of the record's loader for screen readers, which says the Task loads. */}
      <div className="block-loader task-head-loader">
        <Skeleton width={120} height={10} />
        <Skeleton width="46%" height={22} />
        <Skeleton width="34%" height={12} />
      </div>
      <RailLoader reads={pipelineReads} />
      <div className="task-columns">
        <div className="task-record-column">
          <BlockLoader shape="text" label="Loading the Task…" />
        </div>
        <div className="task-conversation task-conversation-loading">
          <BlockLoader shape="turns" label="Loading the conversation…" />
        </div>
      </div>
    </>
  );
}

/** The head's Pipeline: its name, or a muted placeholder while none is chosen, never "removed". */
export function HeadPipeline({
  task,
  pipeline,
  editedForTask,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
  readonly editedForTask: boolean;
}): ReactNode {
  if (task.pipelineId === null) {
    return (
      <span className="task-head-pipeline-not-chosen">
        Pipeline <b>{PIPELINE_NOT_CHOSEN}</b>
      </span>
    );
  }
  return (
    <span>
      Pipeline <b>{pipelineLabel(pipeline?.name ?? REMOVED_PIPELINE, editedForTask)}</b>
    </span>
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
  const actions = useTaskActions(task, taskStages?.stages);
  return (
    <header className="task-head">
      <div className="task-head-grow">
        <div className="task-head-crumb">
          <ProjectChip projectId={task.projectId} projects={projects} />
        </div>
        <div className="task-head-title">
          <TaskTitle task={task} />
          <TaskStateBadge
            state={task.state}
            pausedBy={task.pausedBy}
            resumesAt={task.resumesAt}
            stopped={stoppedAtCurrentStage(taskStages?.stages ?? [])}
            {...((task.state === "in-progress" || task.state === "planning") && { tone: "info" })}
          />
          {waitingOnYou(task) && <TaskStateBadge state="waiting-on-you" />}
          <ArchivedBadge record={task} />
          <EngineStandInsMark task={task} />
        </div>
        <div className="task-head-meta">
          <OffBoardTaskBadge madeFor={task.madeFor} />
          <span className="task-head-priority task-head-kind">
            <KindGlyph kind={task.kind} size={12} />
            {KIND_NAMES[task.kind]}
          </span>
          <span className="task-head-priority">
            <PriorityGlyph priority={task.priority} size={12} />
            {PRIORITY_NAMES[task.priority]} priority
          </span>
          <HeadPipeline task={task} pipeline={pipeline} editedForTask={editedForTask} />
          {task.estimatedTokens === null ? (
            <TokenCount tokens={tokens} label="tokens" />
          ) : (
            <TokenMeter tokens={tokens} estimatedTokens={task.estimatedTokens} />
          )}
          <TaskTags task={task} />
        </div>
      </div>
      <RecordActions
        actions={actions}
        menu={<TaskMenu task={task} actions={actions} offersBranchDeletion />}
        className="task-head-actions"
      />
      <OffBoardTaskNote task={task} projects={projects} />
      <StartNotes task={task} />
      <DropNote task={task} />
    </header>
  );
}

/** While a started Task's run works on Stand-in Engines, which and for what, with why on hover. */
export function EngineStandInsMark({ task }: { readonly task: Task }): ReactNode {
  const standIns = engineStandInsShown(task);
  if (standIns.length === 0) return null;
  return (
    <Tooltip content={engineStandInsReasons(standIns)} focusable>
      <Badge tone="info">{engineStandInsWords(standIns)}</Badge>
    </Tooltip>
  );
}

/** Overview, Changes, Attachments and Engine, with how many files the Task changed and it holds. */
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
        { value: "engine", label: "Engine" },
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
    case "engine":
      return (
        <div className="task-record">
          <TaskEngineBlock task={task} />
        </div>
      );
    case undefined:
      return <TaskRecord task={task} />;
  }
}
