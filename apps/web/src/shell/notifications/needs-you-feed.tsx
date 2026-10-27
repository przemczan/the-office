import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { NeedsYouItem, Project, Role, Task } from "@the-office/contracts";
import { Avatar, Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { DecisionCard } from "../conversation/decision-card.tsx";
import { EmptyCard, ItemCard } from "../item-card.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { GateActions } from "../work/gate-actions.tsx";
import { waitingGateOf } from "../work/gate-words.ts";
import "./notifications.css";

/**
 * What waits on the user, oldest first, each answered where it shows (spec §1): a Decision with its
 * options, a Gate with Continue, Send back and Drop. The same on Now and in the Needs you panel.
 */
export function NeedsYouFeed({ items }: { readonly items: readonly NeedsYouItem[] }): ReactNode {
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  if (items.length === 0) return <EmptyCard>Nothing needs you. Enjoy it.</EmptyCard>;
  return items.map((item) =>
    item.kind === "decision" ? (
      <WaitingDecision
        key={item.decisionId}
        decisionId={item.decisionId}
        taskId={item.taskId}
        projects={projects}
        roles={roles}
      />
    ) : (
      <WaitingGate key={item.taskId} taskId={item.taskId} projects={projects} roles={roles} />
    ),
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
  const asker = roles?.find(({ key }) => key === decision.roleKey);
  return (
    <ItemCard edge="decision" label={`Decision on ${task.title}`}>
      {asker && <Avatar name={asker.card.name} size="sm" />}
      <div className="needs-you-item">
        <TaskHeading task={task} projects={projects} />
        <DecisionCard
          decision={decision}
          personName={asker?.card.name ?? "The Office"}
          answering={false}
          followUps={false}
        />
      </div>
    </ItemCard>
  );
}

function WaitingGate({ taskId, projects, roles }: ItemProps): ReactNode {
  const task = useQuery(taskQueries.one(taskId)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(taskId)).data?.stages;
  const waiting = taskStages && waitingGateOf(taskStages);
  if (!task || !waiting) return null;
  return (
    <ItemCard edge="gate" label={`Gate: ${task.title}`}>
      <div className="needs-you-item">
        <TaskHeading task={task} projects={projects} badge={<Badge tone="info">Gate</Badge>} />
        <div className="needs-you-sub">
          {waiting.gate.name}
          {waiting.next && ` · before ${waiting.next.name}`} ·{" "}
          <Link to="/tasks/$taskId" params={{ taskId }} search={{ recordTab: "changes" }}>
            Open Changes
          </Link>
        </div>
        <GateActions task={task} waiting={waiting} roles={roles} />
      </div>
    </ItemCard>
  );
}

function TaskHeading({
  task,
  projects,
  badge,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  readonly badge?: ReactNode;
}): ReactNode {
  return (
    <div className="needs-you-heading">
      {badge}
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="needs-you-title">
        {task.title}
      </Link>
      <ProjectChip projectId={task.projectId} projects={projects} />
    </div>
  );
}
