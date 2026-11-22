import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import {
  type Decision,
  type Initiative,
  type Project,
  type ReadyTasksStarted,
  type Role,
  type TaskSummary,
} from "@the-office/contracts";
import { Alert, Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, useEveryTask } from "../../api/work.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { initiativeProgress, progressWords } from "../../shell/work/initiative-progress.ts";
import { useShaper } from "../../shell/work/use-shaper.ts";
import { ArchivedBadge } from "./archive-parts.tsx";
import { InitiativeAttachments } from "./attachments-block.tsx";
import { ConversationDrawerProvider } from "./conversation-drawer.tsx";
import { InitiativeActions } from "./initiative-actions.tsx";
import { InitiativeConversation } from "./initiative-conversation.tsx";
import { TakeOutDialog } from "./initiative-membership.tsx";
import { tasksToTakeOut } from "./initiative-membership-words.ts";
import { InitiativeProjects, InitiativeStateBadge } from "./initiative-parts.tsx";
import { InitiativePausedBadge } from "./initiative-pause.tsx";
import { InitiativePipelineBlock } from "./initiative-pipeline-block.tsx";
import { InitiativeTestInstancesBlock } from "./initiative-test-instances-block.tsx";
import { planningProgressWords } from "./initiative-planning-words.ts";
import { ordinaryTasksOf, tasksFoldSummary, tasksOfInitiative } from "./initiative-words.ts";
import { MissingRecord } from "./missing-record.tsx";
import { WorkTabs } from "./work-tabs.tsx";
import { OriginBlock } from "./origin-block.tsx";
import { OutcomeBlock } from "./outcome-block.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { StartReadyTasksNote } from "./start-ready-tasks.tsx";
import { TaskGraph } from "./task-graph.tsx";

const NO_DECISIONS: readonly Decision[] = [];

/**
 * An Initiative's page (prototypes/app/work.js `initiativePage`): its Tasks as a graph across
 * Projects, its record's folds, and its conversation, a tab per person as on the Task page.
 */
export function InitiativePage(): ReactNode {
  const { initiativeId } = useParams({ from: "/work/initiatives/$initiativeId" });
  const { testInstance } = useSearch({ from: "/work/initiatives/$initiativeId" });
  const initiative = useQuery(initiativeQueries.one(initiativeId));
  const tasks = useEveryTask();
  const projects = useQuery(projectQueries.list());
  // What waits on the user, for the planning steps; the Decisions' events keep it current.
  const openDecisions = useQuery(decisionQueries.open()).data ?? NO_DECISIONS;
  const shaper = useShaper();
  const [readyTasksStarted, setReadyTasksStarted] = useState<{
    readonly initiativeId: string;
    readonly started: ReadyTasksStarted;
  }>();
  usePageHeading({
    title: initiative.data?.name ?? "Work",
    parent: { label: "Initiatives", to: "/work/initiatives" },
    crumb: initiative.data?.name,
  });
  if (initiative.error) return <MissingRecord error={initiative.error} kind="Initiative" />;
  const record = initiative.data;
  if (!record || !tasks.data) {
    return (
      <div className="task-page">
        <WorkTabs shown="initiatives" />
      </div>
    );
  }
  const initiativeTasks = tasksOfInitiative(record, tasks.data);
  return (
    // The tabs stay inside the page's first element, which the conversation's fit watches.
    <div className="task-page">
      <WorkTabs shown="initiatives" />
      <InitiativeHead
        initiative={record}
        initiativeTasks={initiativeTasks}
        tasks={tasks.data}
        openDecisions={openDecisions}
        projects={projects.data}
        shaper={shaper}
        onStartedReadyTasks={(started) => setReadyTasksStarted({ initiativeId, started })}
      />
      {readyTasksStarted?.initiativeId === initiativeId && (
        <StartReadyTasksNote
          started={readyTasksStarted.started}
          onClose={() => setReadyTasksStarted(undefined)}
        />
      )}
      <TasksBlock
        initiative={record}
        initiativeTasks={ordinaryTasksOf(record, tasks.data)}
        tasks={tasks.data}
        openDecisions={openDecisions}
        projects={projects.data}
        shaper={shaper}
      />
      <ConversationDrawerProvider key={record.id}>
        <div className="task-columns">
          <section className="task-record" aria-label="Record">
            {record.state === "shaping" && <ShapingNote shaper={shaper} />}
            <InitiativePipelineBlock
              initiative={record}
              tasks={tasks.data}
              projects={projects.data}
            />
            <InitiativeTestInstancesBlock
              initiative={record}
              projects={projects.data}
              linkedTo={testInstance}
            />
            <OutcomeBlock initiative={record} />
            <InitiativeAttachments initiative={record} />
            <OriginBlock
              record={{ kind: "initiative", id: record.id }}
              ideaId={record.originIdeaId}
            />
          </section>
          <InitiativeConversation initiative={record} />
        </div>
      </ConversationDrawerProvider>
    </div>
  );
}

function InitiativeHead({
  initiative,
  initiativeTasks,
  tasks,
  openDecisions,
  projects,
  shaper,
  onStartedReadyTasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly TaskSummary[];
  readonly tasks: readonly TaskSummary[];
  readonly openDecisions: readonly Decision[];
  readonly projects: readonly Project[] | undefined;
  readonly shaper: Role | undefined;
  readonly onStartedReadyTasks: (started: ReadyTasksStarted) => void;
}): ReactNode {
  const planningProgress = planningProgressWords(initiative, initiativeTasks, openDecisions);
  return (
    <header className="task-head">
      <div className="task-head-grow">
        <h2>{initiative.name}</h2>
        <div className="task-head-meta">
          <span className="task-head-badges">
            <InitiativeStateBadge initiative={initiative} shaper={shaper} />
            <InitiativePausedBadge initiative={initiative} />
            <ArchivedBadge record={initiative} />
          </span>
          <InitiativeProjects initiative={initiative} projects={projects} />
          <span>· {progressWords(initiativeProgress(initiativeTasks, tasks))}</span>
          {planningProgress && <span>· {planningProgress}</span>}
        </div>
      </div>
      <InitiativeActions
        initiative={initiative}
        onStartedReadyTasks={onStartedReadyTasks}
        className="task-head-actions"
      />
    </header>
  );
}

/**
 * The Initiative's own Tasks as a graph, in a fold remembered per Initiative in this browser; its
 * line says what the graph holds and what moves. Take out a Task, while one hasn't started, asks
 * which and says what happens to its state.
 */
function TasksBlock({
  initiative,
  initiativeTasks,
  tasks,
  openDecisions,
  projects,
  shaper,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly TaskSummary[];
  readonly tasks: readonly TaskSummary[];
  readonly openDecisions: readonly Decision[];
  readonly projects: readonly Project[] | undefined;
  readonly shaper: Role | undefined;
}): ReactNode {
  const fold = useFold({ kind: "initiative", id: initiative.id }, "tasks", true);
  const initiatives = useQuery(initiativeQueries.list());
  const [takingOut, setTakingOut] = useState(false);
  const toTakeOut = tasksToTakeOut(initiative, initiativeTasks);
  return (
    <RecordFold
      fold={fold}
      icon="git-fork"
      title="Tasks"
      summary={tasksFoldSummary(initiative, initiativeTasks)}
      side={
        toTakeOut.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => setTakingOut(true)}>
            Take out a Task
          </Button>
        ) : undefined
      }
    >
      {takingOut && (
        <TakeOutDialog
          initiative={initiative}
          candidates={toTakeOut}
          projects={projects}
          onClose={() => setTakingOut(false)}
        />
      )}
      {initiativeTasks.length === 0 ? (
        <p className="task-quiet">
          No Tasks yet.
          {shaper &&
            initiative.state === "shaping" &&
            ` ${shaper.card.name} drafts them with you in the conversation, straight onto this page.`}
        </p>
      ) : (
        <TaskGraph
          initiative={initiative}
          tasks={tasks}
          openDecisions={openDecisions}
          initiatives={initiatives.data}
          projects={projects}
        />
      )}
    </RecordFold>
  );
}

function ShapingNote({ shaper }: { readonly shaper: Role | undefined }): ReactNode {
  return (
    <Alert tone="info">
      {shaper
        ? `${shaper.card.name} drafts the outcome and the Tasks with you in the conversation, straight onto this page. Once you confirm the Initiative, each change ${shaper.card.name} wants is a Proposal you apply.`
        : "Write the outcome and add the Tasks, then confirm the Initiative to make it active."}
    </Alert>
  );
}
