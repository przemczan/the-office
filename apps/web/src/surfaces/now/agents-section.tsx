import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import { useMemo, type ReactNode } from "react";
import { liveViewQueries } from "../../api/live-view.ts";
import { nowQueries } from "../../api/notifications.ts";
import { initiativeQueries, useEveryTask } from "../../api/work.ts";
import { Feed, PanelHeading } from "../../shell/desk.tsx";
import { EmptyCard, ItemCard } from "../../shell/item-card.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { durationWords } from "../../shell/time.ts";
import { OffBoardTaskBadge } from "../../shell/work/off-board-task-badge.tsx";
import { workingAgentsOf, type WorkingAgent, type WorkingAgentTarget } from "./working-agents.ts";

/**
 * Every Agent session answering now, whatever it works on (a Stage, planning, shaping, a
 * Consultation or a chat), from the Live view's snapshot; nothing while none does.
 */
export function AgentsSection({
  projects,
  clock,
}: {
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const snapshot = useQuery(liveViewQueries.snapshot()).data;
  const tasks = useEveryTask().data;
  const initiatives = useQuery(initiativeQueries.list()).data;
  const running = useQuery(nowQueries.now()).data?.running;
  const agents = useMemo(
    () =>
      snapshot
        ? workingAgentsOf(snapshot, {
            tasks: tasks ?? [],
            initiatives: initiatives ?? [],
            running: running ?? [],
          })
        : [],
    [snapshot, tasks, initiatives, running],
  );
  const { shows } = useProjectFilter();
  if (agents.length === 0) return null;
  const { shown, elsewhere } = narrowed(agents, ({ projectIds }) => shows(projectIds));
  return (
    <>
      <PanelHeading icon="bot" title="Agents" count={String(agents.length)} />
      <Feed>
        {shown.length === 0 && <EmptyCard>No Agent works in these Projects.</EmptyCard>}
        {shown.map((agent) => (
          <AgentCard key={agent.threadId} agent={agent} projects={projects} clock={clock} />
        ))}
        <InOtherProjectsNote count={elsewhere} one="Agent" many="Agents" />
      </Feed>
    </>
  );
}

function AgentCard({
  agent,
  projects,
  clock,
}: {
  readonly agent: WorkingAgent;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  return (
    <ItemCard edge="running" label={`${agent.personName} works: ${agent.badge} ${agent.title}`}>
      <div className="now-item">
        <div className="now-item-heading">
          <PersonAvatar roleKey={agent.roleKey} name={agent.personName} size="xs" />
          {agent.personName}
          <Badge tone="info" size="sm">
            {agent.badge}
          </Badge>
          <ThreadLink target={agent.target}>{agent.title}</ThreadLink>
          <OffBoardTaskBadge madeFor={agent.madeFor} />
          {agent.projectIds.map((projectId) => (
            <ProjectChip key={projectId} projectId={projectId} projects={projects} />
          ))}
        </div>
        <div className="now-item-sub">
          {agent.engineWords}
          {agent.engineWords !== null && agent.since !== null && <span>·</span>}
          {agent.since !== null && (
            <time dateTime={agent.since}>
              {durationWords(Math.max(0, clock.getTime() - Date.parse(agent.since)))} working
            </time>
          )}
        </div>
      </div>
    </ItemCard>
  );
}

/** The row's title, opening the Thread it is about. */
function ThreadLink({
  target,
  children,
}: {
  readonly target: WorkingAgentTarget;
  readonly children: ReactNode;
}): ReactNode {
  switch (target.kind) {
    case "task":
      return (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: target.taskId }}
          search={{ taskThread: target.threadId }}
          className="now-item-title"
        >
          {children}
        </Link>
      );
    case "initiative":
      return (
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: target.initiativeId }}
          search={{ initiativeThread: target.threadId }}
          className="now-item-title"
        >
          {children}
        </Link>
      );
    case "chat":
      return (
        <Link
          to="/now"
          search={{ chat: target.roleKey, thread: target.threadId }}
          className="now-item-title"
        >
          {children}
        </Link>
      );
  }
}
