import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FinishedTask, Now, Project, Role, RunningTask } from "@the-office/contracts";
import { Avatar, Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { Desk, Feed, Panel, PanelHeading } from "../../shell/desk.tsx";
import { EmptyCard, ItemCard } from "../../shell/item-card.tsx";
import { NeedsYouFeed } from "../../shell/notifications/needs-you-feed.tsx";
import { useNeedsYou } from "../../shell/notifications/use-needs-you.ts";
import {
  desksWords,
  inStageWords,
  OUTCOME_EDGES,
  OUTCOME_NAMES,
  OUTCOME_TONES,
  sinceWords,
} from "../../shell/notifications/now-words.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed, type Narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { momentWords } from "../../shell/time.ts";
import { useClock } from "../../shell/use-clock.ts";
import { TASK_STATE_NAMES, TASK_STATE_TONES } from "../../shell/work/work-words.ts";
import "./now.css";

/**
 * Home: what needs the user, what is running, what happened since they left, and today's tokens;
 * nothing else (spec §4). Each Decision and Gate is answered in place. The Project filter narrows
 * the three feeds; desks and tokens stay Office-wide.
 */
export function NowPage(): ReactNode {
  const now = useQuery(nowQueries.now()).data;
  const needsYou = useNeedsYou();
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  const clock = useClock();
  return (
    <Desk>
      <Panel label="Needs you">
        <PanelHeading
          icon="inbox"
          title="Needs you"
          count={needsYou && String(needsYou.shown.length)}
        />
        <Feed>{needsYou && <NeedsYouFeed needsYou={needsYou} />}</Feed>
      </Panel>
      <Panel label="Running and since you left">
        <PanelHeading
          icon="activity"
          title="Running"
          count={now && desksWords(now)}
          action={{ label: "Open Work", to: "/work" }}
        />
        <Feed>
          {now && <RunningFeed now={now} projects={projects} roles={roles} clock={clock} />}
        </Feed>
        <PanelHeading
          icon="moon"
          title="Since you left"
          count={now && sinceWords(now.leftAt, clock)}
        />
        <Feed>{now && <SinceYouLeftFeed now={now} projects={projects} clock={clock} />}</Feed>
        {now && <TodaysTokens now={now} />}
      </Panel>
    </Desk>
  );
}

function RunningFeed({
  now,
  projects,
  roles,
  clock,
}: {
  readonly now: Now;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { shown, elsewhere } = useNarrowedByProject(now.running);
  return (
    <>
      {shown.length === 0 && (
        <EmptyCard>
          {elsewhere > 0 ? "Nothing is running in these Projects." : "Nothing is running."}
        </EmptyCard>
      )}
      {shown.map((task) => (
        <RunningCard
          key={task.taskId}
          task={task}
          projects={projects}
          roles={roles}
          clock={clock}
        />
      ))}
      <InOtherProjectsNote count={elsewhere} one="Task" many="Tasks" />
    </>
  );
}

function RunningCard({
  task,
  projects,
  roles,
  clock,
}: {
  readonly task: RunningTask;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { stage } = task;
  const person = stage?.role ? roles?.find(({ key }) => key === stage.role) : undefined;
  return (
    <ItemCard
      edge={task.state === "in-progress" ? "running" : "paused"}
      label={`Running: ${task.title}`}
    >
      <div className="now-item">
        <div className="now-item-heading">
          <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="now-item-title">
            {task.title}
          </Link>
          <ProjectChip projectId={task.projectId} projects={projects} />
          {task.state !== "in-progress" && (
            <Badge tone={TASK_STATE_TONES[task.state]}>{TASK_STATE_NAMES[task.state]}</Badge>
          )}
        </div>
        <div className="now-item-sub">
          {stage === null ? (
            "Starting"
          ) : (
            <>
              {person && <Avatar name={person.card.name} size="xs" />}
              {person ? person.card.name : "No Agent"}
              <span>·</span>
              <Badge size="sm">{stage.name}</Badge>
              <span>·</span>
              {inStageWords(stage, clock)}
            </>
          )}
        </div>
      </div>
    </ItemCard>
  );
}

function SinceYouLeftFeed({
  now,
  projects,
  clock,
}: {
  readonly now: Now;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { shown, elsewhere } = useNarrowedByProject(now.sinceYouLeft);
  return (
    <>
      {shown.length === 0 && (
        <EmptyCard>
          {elsewhere > 0
            ? "Nothing finished in these Projects since you left."
            : "Nothing finished since you left."}
        </EmptyCard>
      )}
      {shown.map((task) => (
        <FinishedCard key={task.taskId} task={task} projects={projects} clock={clock} />
      ))}
      <InOtherProjectsNote count={elsewhere} one="Task" many="Tasks" />
    </>
  );
}

function useNarrowedByProject<T extends { readonly projectId: string }>(
  tasks: readonly T[],
): Narrowed<T> {
  const { shows } = useProjectFilter();
  return narrowed(tasks, ({ projectId }) => shows([projectId]));
}

function FinishedCard({
  task,
  projects,
  clock,
}: {
  readonly task: FinishedTask;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  return (
    <ItemCard
      edge={OUTCOME_EDGES[task.outcome]}
      label={`${OUTCOME_NAMES[task.outcome]}: ${task.title}`}
    >
      <div className="now-item">
        <div className="now-item-heading">
          <Badge tone={OUTCOME_TONES[task.outcome]}>{OUTCOME_NAMES[task.outcome]}</Badge>
          <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="now-item-title">
            {task.title}
          </Link>
          <ProjectChip projectId={task.projectId} projects={projects} />
        </div>
      </div>
      <time className="now-item-time" dateTime={task.occurredAt}>
        {momentWords(task.occurredAt, clock)}
      </time>
    </ItemCard>
  );
}

function TodaysTokens({ now }: { readonly now: Now }): ReactNode {
  return (
    <p className="now-tokens">
      <b>{tokensShort(now.tokensToday)}</b> tokens today
      {now.fiveHourWindow && (
        <>
          {" "}
          · <b>{Math.round(now.fiveHourWindow.percentUsed)}%</b> of the 5-hour window
        </>
      )}
    </p>
  );
}
