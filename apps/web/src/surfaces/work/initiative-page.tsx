import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ENDED_INITIATIVE_CONVERSATION_WORDS,
  type Initiative,
  type Project,
  type Role,
  type Task,
} from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, startShapingThread, taskQueries } from "../../api/work.ts";
import { EmptyCard } from "../../shell/item-card.tsx";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { useCto } from "../../shell/work/use-cto.ts";
import { ArchivedBadge, RestoreInitiativeButton } from "./archive-parts.tsx";
import { InitiativeAttachments } from "./attachments-block.tsx";
import { ConversationDrawerProvider, useDrawerFollowsAddress } from "./conversation-drawer.tsx";
import { InitiativeActions } from "./initiative-actions.tsx";
import { InitiativeProjects, InitiativeStateBadge } from "./initiative-parts.tsx";
import { planningProgressWords } from "./initiative-planning-words.ts";
import { initiativeProgress, progressWords, tasksOfInitiative } from "./initiative-words.ts";
import { MissingRecord } from "./missing-record.tsx";
import { OriginBlock } from "./origin-block.tsx";
import { OutcomeBlock } from "./outcome-block.tsx";
import { RecordBlock } from "./record-block.tsx";
import { TaskGraph } from "./task-graph.tsx";
import { ThreadTimeline } from "./thread-timeline.tsx";

/**
 * An Initiative's page (prototypes/app/work.js `initiativePage`): its Tasks as a graph across
 * Projects, its record's folds, and its Threads with the CTO and the Planner as the Task page's timeline.
 */
export function InitiativePage(): ReactNode {
  const { initiativeId } = useParams({ from: "/work/initiatives/$initiativeId" });
  const initiative = useQuery(initiativeQueries.one(initiativeId));
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const cto = useCto();
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
        projects={projects.data}
        cto={cto}
      />
      <TasksBlock
        initiative={record}
        initiativeTasks={initiativeTasks}
        tasks={tasks.data}
        projects={projects.data}
        cto={cto}
      />
      <ConversationDrawerProvider key={record.id}>
        <div className="task-columns">
          <section className="task-record" aria-label="Record">
            {record.state === "shaping" && <ShapingNote cto={cto} />}
            <OutcomeBlock initiative={record} />
            <InitiativeAttachments initiative={record} />
            <OriginBlock
              record={{ kind: "initiative", id: record.id }}
              ideaId={record.originIdeaId}
            />
          </section>
          <InitiativeConversation initiative={record} cto={cto} />
        </div>
      </ConversationDrawerProvider>
    </div>
  );
}

function InitiativeHead({
  initiative,
  initiativeTasks,
  tasks,
  projects,
  cto,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  readonly cto: Role | undefined;
}): ReactNode {
  const planningProgress = planningProgressWords(initiative, initiativeTasks);
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
        <InitiativeActions initiative={initiative} />
      </div>
    </header>
  );
}

function TasksBlock({
  initiative,
  initiativeTasks,
  tasks,
  projects,
  cto,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly Task[];
  readonly tasks: readonly Task[];
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

/** Its Threads with the CTO and the Planner; while it is open and has none, the user can start shaping one. */
function InitiativeConversation({
  initiative,
  cto,
}: {
  readonly initiative: Initiative;
  readonly cto: Role | undefined;
}): ReactNode {
  const { initiativeThread } = useSearch({ from: "/work/initiatives/$initiativeId" });
  const navigate = useNavigate({ from: "/work/initiatives/$initiativeId" });
  const threads = useQuery(threadQueries.onInitiative(initiative.id)).data;
  const readOnlyReason = ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state];
  useDrawerFollowsAddress(
    threads && threads.length > 0
      ? { threadId: initiativeThread, decisionId: undefined, decisionIsOpen: false }
      : undefined,
  );
  if (!threads) return null;
  if (threads.length === 0) {
    return (
      <aside className="task-conversation" aria-label="Conversation">
        <EmptyCard>
          No conversation on {initiative.name} yet.
          {readOnlyReason === undefined &&
            (cto ? (
              <StartShaping initiative={initiative} cto={cto} />
            ) : (
              " Hire a CTO to shape it with them."
            ))}
        </EmptyCard>
      </aside>
    );
  }
  return (
    <ThreadTimeline
      threads={threads}
      asked={initiativeThread}
      onAsked={(threadId) => {
        void navigate({
          search: threadId === undefined ? {} : { initiativeThread: threadId },
          replace: true,
          resetScroll: false,
        });
      }}
      readOnlyReason={readOnlyReason}
    />
  );
}

function StartShaping({
  initiative,
  cto,
}: {
  readonly initiative: Initiative;
  readonly cto: Role;
}): ReactNode {
  const showToast = useToast();
  const starting = useMutation({
    mutationFn: () => startShapingThread(initiative.id),
    onError: (error) => showToast(error.message),
  });
  return (
    <div className="task-conversation-start">
      <Button
        variant="secondary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={starting.isPending}
        onClick={() => starting.mutate()}
      >
        Shape it with {cto.card.name}
      </Button>
    </div>
  );
}
