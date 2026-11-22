import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Decision, NeedsYouItem, Project, Role, Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { DecisionOnTask } from "../conversation/decision-on-task.tsx";
import { useDecisionThread } from "../conversation/decision-parts.tsx";
import { EmptyCard, ItemCard } from "../item-card.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { InOtherProjectsNote } from "../project-filter/in-other-projects-note.tsx";
import type { Narrowed } from "../project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";
import { clockOf } from "../time.ts";
import { GateCard } from "../work/gate-card.tsx";
import { waitingGateOf } from "../work/gate-words.ts";
import { NeedsYouList } from "../work/needs-you-list.tsx";
import { isOffBoardFailure, OffBoardFailedCard } from "./off-board-failed-card.tsx";
import { StandInChoiceCard } from "./stand-in-choice-card.tsx";
import "./notifications.css";

/**
 * What waits on the user, oldest first, each answered where it shows (spec §4): the Task page's
 * Decision and Gate cards, under the Task's title and Project, as nothing around them says which
 * Task it is, and a Decision on no Task in an Initiative's Thread under the Initiative's title and
 * Projects; The Office's own Decision on the Stages waiting for a Stand-in Engine, one card for
 * them all, its rows narrowed by the Project filter too; an Off-board Task's out-of-tries Decision,
 * once it is the user's, as its "Off-board Task failed" card with Retry. The same on Now and in the
 * Needs you panel.
 */
export function NeedsYouFeed({
  needsYou,
}: {
  readonly needsYou: Narrowed<NeedsYouItem>;
}): ReactNode {
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  const { shows } = useProjectFilter();
  const { shown, elsewhere } = needsYou;
  return (
    <>
      {shown.length === 0 && (
        <EmptyCard>
          {elsewhere > 0 ? "Nothing needs you in these Projects." : "Nothing needs you. Enjoy it."}
        </EmptyCard>
      )}
      {shown.map((item) => {
        switch (item.kind) {
          case "decision":
            if (isOffBoardFailure(item)) {
              return <OffBoardFailedCard key={item.decisionId} item={item} projects={projects} />;
            }
            return (
              <WaitingDecision
                key={item.decisionId}
                decisionId={item.decisionId}
                taskId={item.taskId}
                projects={projects}
                roles={roles}
              />
            );
          case "initiative-decision":
            return (
              <WaitingInitiativeDecision
                key={item.decisionId}
                item={item}
                projects={projects}
                roles={roles}
              />
            );
          case "gate":
            return (
              <WaitingGate
                key={item.taskId}
                taskId={item.taskId}
                projects={projects}
                roles={roles}
              />
            );
          case "stand-in-choice":
            return (
              <StandInChoiceCard
                key="stand-in-choice"
                projectShown={(projectId) => shows([projectId])}
              />
            );
        }
      })}
      <InOtherProjectsNote count={elsewhere} one="needs you" many="need you" />
    </>
  );
}

interface ItemProps {
  readonly taskId: string;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}

function WaitingDecision({
  decisionId,
  taskId,
  projects,
  roles,
}: ItemProps & { readonly decisionId: string }): ReactNode {
  const decision = useQuery(decisionQueries.open()).data?.find(({ id }) => id === decisionId);
  const task = useQuery(taskQueries.one(taskId)).data;
  if (!decision || !task) return null;
  return (
    <ItemCard edge="decision" label={`Decision on ${task.title}`}>
      <OnTask task={task} projects={projects}>
        <AskedDecision decision={decision} roles={roles} />
      </OnTask>
    </ItemCard>
  );
}

/**
 * A Decision on no Task, in an Initiative's shaping or planning Thread: under the Initiative's
 * title, linking to that Thread with the card brought into view, and its Projects.
 */
function WaitingInitiativeDecision({
  item,
  projects,
  roles,
}: {
  readonly item: Extract<NeedsYouItem, { kind: "initiative-decision" }>;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const decision = useQuery(decisionQueries.open()).data?.find(({ id }) => id === item.decisionId);
  const initiative = useQuery(initiativeQueries.one(item.initiativeId)).data;
  if (!decision || !initiative) return null;
  return (
    <ItemCard edge="decision" label={`Decision on ${initiative.name}`}>
      <div className="needs-you-item">
        <div className="needs-you-heading">
          <Link
            to="/work/initiatives/$initiativeId"
            params={{ initiativeId: initiative.id }}
            search={{ initiativeThread: item.threadId, decision: item.decisionId }}
            className="needs-you-title"
          >
            {initiative.name}
          </Link>
          {item.projectIds.map((projectId) => (
            <ProjectChip key={projectId} projectId={projectId} projects={projects} />
          ))}
        </div>
        <NeedsYouList>
          <AskedDecision decision={decision} roles={roles} />
        </NeedsYouList>
      </div>
    </ItemCard>
  );
}

/** When it was asked stands for the place on the Task's page, which needs the page around it. */
function AskedDecision({
  decision,
  roles,
}: {
  readonly decision: Decision;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const { card } = useDecisionThread(decision, roles);
  return (
    <DecisionOnTask
      decision={decision}
      {...card}
      where="feed"
      place={<span className="needs-you-time">{clockOf(decision.askedAt)}</span>}
    />
  );
}

function WaitingGate({ taskId, projects, roles }: ItemProps): ReactNode {
  const task = useQuery(taskQueries.one(taskId)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(taskId)).data;
  const waiting = taskStages?.stages ? waitingGateOf(taskStages.stages) : undefined;
  if (!task || !taskStages || !waiting) return null;
  return (
    <ItemCard edge="gate" label={`Gate: ${task.title}`}>
      <OnTask task={task} projects={projects}>
        <GateCard task={task} taskStages={taskStages} waiting={waiting} roles={roles} />
      </OnTask>
    </ItemCard>
  );
}

function OnTask({
  task,
  projects,
  children,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="needs-you-item">
      <div className="needs-you-heading">
        <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="needs-you-title">
          {task.title}
        </Link>
        <ProjectChip projectId={task.projectId} projects={projects} />
      </div>
      <NeedsYouList>{children}</NeedsYouList>
    </div>
  );
}
