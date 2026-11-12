import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  type Decision,
  type Initiative,
  type Project,
  type ReadyTasksStarted,
  type Role,
  type Task,
} from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { useCto } from "../../shell/work/use-cto.ts";
import { ArchivedBadge, RestoreInitiativeButton } from "./archive-parts.tsx";
import { InitiativeAttachments } from "./attachments-block.tsx";
import { ConversationDrawerProvider } from "./conversation-drawer.tsx";
import { InitiativeActions } from "./initiative-actions.tsx";
import { InitiativeConversation } from "./initiative-conversation.tsx";
import { InitiativeProjects, InitiativeStateBadge } from "./initiative-parts.tsx";
import { InitiativePipelineBlock } from "./initiative-pipeline-block.tsx";
import { planningProgressWords } from "./initiative-planning-words.ts";
import { initiativeProgress, progressWords, tasksOfInitiative } from "./initiative-words.ts";
import { MissingRecord } from "./missing-record.tsx";
import { OriginBlock } from "./origin-block.tsx";
import { OutcomeBlock } from "./outcome-block.tsx";
import { RecordBlock } from "./record-block.tsx";
import { StartReadyTasksNote } from "./start-ready-tasks.tsx";
import { TaskGraph } from "./task-graph.tsx";

const NO_DECISIONS: readonly Decision[] = [];

/**
 * An Initiative's page (prototypes/app/work.js `initiativePage`): its Tasks as a graph across
 * Projects, its record's folds, and its conversation, a tab per person as on the Task page.
 */
export function InitiativePage(): ReactNode {
  const { initiativeId } = useParams({ from: "/work/initiatives/$initiativeId" });
  const initiative = useQuery(initiativeQueries.one(initiativeId));
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  // What waits on the user, for the planning steps; the Decisions' events keep it current.
  const openDecisions = useQuery(decisionQueries.open()).data ?? NO_DECISIONS;
  const cto = useCto();
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
  if (!record || !tasks.data) return null;
  const initiativeTasks = tasksOfInitiative(record, tasks.data);
  return (
    <div className="task-page">
      <InitiativeHead
        initiative={record}
        initiativeTasks={initiativeTasks}
        tasks={tasks.data}
        openDecisions={openDecisions}
        projects={projects.data}
        cto={cto}
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
        initiativeTasks={initiativeTasks}
        tasks={tasks.data}
        openDecisions={openDecisions}
        projects={projects.data}
        cto={cto}
      />
      <ConversationDrawerProvider key={record.id}>
        <div className="task-columns">
          <section className="task-record" aria-label="Record">
            {record.state === "shaping" && <ShapingNote cto={cto} />}
            <OutcomeBlock initiative={record} />
            <InitiativePipelineBlock initiative={record} projects={projects.data} />
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
  cto,
  onStartedReadyTasks,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
  readonly tasks: readonly Task[];
  readonly openDecisions: readonly Decision[];
  readonly projects: readonly Project[] | undefined;
  readonly cto: Role | undefined;
  readonly onStartedReadyTasks: (started: ReadyTasksStarted) => void;
}): ReactNode {
  const planningProgress = planningProgressWords(initiative, initiativeTasks, openDecisions);
  return (
    <header className="task-head">
      <div className="task-head-grow">
        <h2>{initiative.name}</h2>
        <div className="task-head-meta">
          <span className="task-head-badges">
            <InitiativeStateBadge initiative={initiative} cto={cto} />
            <ArchivedBadge record={initiative} />
          </span>
          <InitiativeProjects initiative={initiative} projects={projects} />
          <span>· {progressWords(initiativeProgress(initiativeTasks, tasks))}</span>
          {planningProgress && <span>· {planningProgress}</span>}
        </div>
      </div>
      <div className="task-head-actions">
        <RestoreInitiativeButton initiative={initiative} />
        <InitiativeActions initiative={initiative} onStartedReadyTasks={onStartedReadyTasks} />
      </div>
    </header>
  );
}

function TasksBlock({
  initiative,
  initiativeTasks,
  tasks,
  openDecisions,
  projects,
  cto,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
  readonly tasks: readonly Task[];
  readonly openDecisions: readonly Decision[];
  readonly projects: readonly Project[] | undefined;
  readonly cto: Role | undefined;
}): ReactNode {
  const initiatives = useQuery(initiativeQueries.list());
  const projectCount = initiative.projectIds.length;
  return (
    <RecordBlock
      icon="git-fork"
      title="Tasks"
      actions={<span className="task-quiet">An arrow means “must be Done first”</span>}
    >
      {initiativeTasks.length === 0 ? (
        <p className="task-quiet">
          No Tasks yet.
          {cto && initiative.state === "shaping" && ` ${cto.card.name} drafts them with you.`}
        </p>
      ) : (
        <>
          <p className="task-quiet">
            {initiativeTasks.length} across {projectCount}{" "}
            {projectCount === 1 ? "Project" : "Projects"}
          </p>
          <TaskGraph
            initiative={initiative}
            tasks={tasks}
            openDecisions={openDecisions}
            initiatives={initiatives.data}
            projects={projects}
          />
        </>
      )}
    </RecordBlock>
  );
}

function ShapingNote({ cto }: { readonly cto: Role | undefined }): ReactNode {
  return (
    <Alert tone="info">
      {cto
        ? `${cto.card.name} drafts the outcome and the Tasks with you in the conversation, straight onto this page. Once you confirm the Initiative, each change ${cto.card.name} wants is a Proposal you apply.`
        : "Write the outcome and add the Tasks, then confirm the Initiative to make it active."}
    </Alert>
  );
}
