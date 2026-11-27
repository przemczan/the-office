import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  FinishedTask,
  Now,
  Project,
  QueuedOnNow,
  Role,
  RunningTask,
  ShapingOnNow,
  SinceYouLeft,
} from "@the-office/contracts";
import { Badge, Tooltip } from "@the-office/ui";
import { Fragment, type ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { Desk, Feed, Panel, PanelHeading } from "../../shell/desk.tsx";
import { EmptyCard, ItemCard } from "../../shell/item-card.tsx";
import { NeedsYouFeed } from "../../shell/notifications/needs-you-feed.tsx";
import { useNeedsYou } from "../../shell/notifications/use-needs-you.ts";
import { useUsageWindows } from "../../shell/notifications/use-usage-windows.ts";
import { useWaitingForYou } from "../../shell/notifications/use-waiting-for-you.ts";
import { WaitingForYouGroup } from "../../shell/notifications/waiting-for-you-feed.tsx";
import {
  desksWords,
  fiveHourWindowName,
  inStageWords,
  OUTCOME_EDGES,
  OUTCOME_NAMES,
  OUTCOME_TONES,
  percentWords,
  sinceWords,
} from "../../shell/notifications/now-words.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { OffBoardTaskBadge } from "../../shell/work/off-board-task-badge.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed, type Narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { durationWords, momentWords } from "../../shell/time.ts";
import { useClock } from "../../shell/use-clock.ts";
import { distinctShortReasons, queueReasonsOf } from "../../shell/work/queue-reasons.ts";
import { UsageEstimateLine, useUsageEstimate } from "../../shell/work/usage-estimate-line.tsx";
import { TASK_STATE_TONES, taskStateWords } from "../../shell/work/work-words.ts";
import { AgentsSection } from "./agents-section.tsx";
import { AlarmPanel } from "./alarm-panel.tsx";
import "./now.css";
import { TokenCount } from "../../shell/token-count.tsx";

/**
 * Home: what needs the user (its Decisions and Gates, then what is Waiting for you), what is running and queued, the Initiatives being shaped, what happened since they left, and today's tokens;
 * nothing else (spec §4), with the fire alarm above while it is on (spec §2.8). Each Decision and Gate is answered in place. The Project filter narrows
 * the three feeds; desks and tokens stay Office-wide.
 */
export function NowPage(): ReactNode {
  const now = useQuery(nowQueries.now()).data;
  const sinceYouLeft = useQuery(nowQueries.sinceYouLeft()).data;
  const needsYou = useNeedsYou();
  const waitingForYou = useWaitingForYou();
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  const clock = useClock();
  return (
    <>
      {now?.fireAlarm && <AlarmPanel alarm={now.fireAlarm} />}
      <Desk>
        <Panel label="Needs you">
          <PanelHeading
            icon="inbox"
            title="Needs you"
            count={needsYou && String(needsYou.shown.length)}
          />
          <Feed>{needsYou && <NeedsYouFeed needsYou={needsYou} />}</Feed>
          {waitingForYou && <WaitingForYouGroup waitingForYou={waitingForYou} />}
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
          <AgentsSection projects={projects} clock={clock} />
          {now && now.queue.length > 0 && (
            <>
              <PanelHeading icon="list-ordered" title="Queue" count={String(now.queue.length)} />
              <Feed>
                <QueueFeed queue={now.queue} projects={projects} />
              </Feed>
            </>
          )}
          {now && now.shaping.length > 0 && (
            <>
              <PanelHeading icon="sparkles" title="Shaping" count={String(now.shaping.length)} />
              <Feed>
                <ShapingFeed
                  shaping={now.shaping}
                  projects={projects}
                  roles={roles}
                  clock={clock}
                />
              </Feed>
            </>
          )}
          <PanelHeading
            icon="moon"
            title="Since you left"
            count={sinceYouLeft && sinceWords(sinceYouLeft.leftAt, clock)}
          />
          <Feed>
            {sinceYouLeft && (
              <SinceYouLeftFeed sinceYouLeft={sinceYouLeft} projects={projects} clock={clock} />
            )}
          </Feed>
          {now && <TodaysTokens now={now} />}
        </Panel>
      </Desk>
    </>
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
          <OffBoardTaskBadge madeFor={task.madeFor} />
          <ProjectChip projectId={task.projectId} projects={projects} />
          {task.state !== "in-progress" && (
            <Badge tone={TASK_STATE_TONES[task.state]}>
              {taskStateWords(task.state, {
                pausedBy: task.pausedBy,
                resumesAt: task.resumesAt,
                now: clock,
              })}
            </Badge>
          )}
        </div>
        <div className="now-item-sub">
          {stage === null ? (
            "Starting"
          ) : (
            <>
              {person && <PersonAvatar roleKey={person.key} name={person.card.name} size="xs" />}
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

/**
 * The queue for Start, first place first: each Task starts by itself once a desk and its person are
 * free and its caps allow it. A queued Task has little to say, so each is one compact row.
 */
function QueueFeed({
  queue,
  projects,
}: {
  readonly queue: readonly QueuedOnNow[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { shown, elsewhere } = useNarrowedByProject(queue);
  return (
    <>
      {shown.length === 0 && <EmptyCard>Nothing is queued in these Projects.</EmptyCard>}
      {shown.length > 0 && (
        <ol className="now-queue">
          {shown.map((task) => (
            <li key={task.taskId}>
              <QueuedRow task={task} projects={projects} />
            </li>
          ))}
        </ol>
      )}
      <InOtherProjectsNote count={elsewhere} one="Task" many="Tasks" />
    </>
  );
}

/**
 * One queued Task on one line: its place, title, badge, Project, short reasons (the full ones on
 * hover or focus, as the board card's Queued mark) and its Usage estimate, read from Work.
 */
function QueuedRow({
  task,
  projects,
}: {
  readonly task: QueuedOnNow;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const estimate = useUsageEstimate(task.taskId);
  const reasons = queueReasonsOf(task);
  const shortReasons = distinctShortReasons(reasons);
  return (
    <ItemCard edge="paused" label={`Queued: ${task.title}`} className="now-queued">
      <span className="now-queued-place">
        <span aria-hidden="true">{task.place}</span>
        <span className="visually-hidden">Place {task.place}</span>
      </span>
      <Link
        to="/tasks/$taskId"
        params={{ taskId: task.taskId }}
        className="now-item-title now-queued-title"
        title={task.title}
      >
        {task.title}
      </Link>
      <OffBoardTaskBadge madeFor={task.madeFor} />
      <ProjectChip projectId={task.projectId} projects={projects} />
      {shortReasons.length > 0 && (
        <Tooltip content={reasons.map(({ reason }) => reason).join(" ")} focusable>
          <span className="now-queued-reasons">{shortReasons.join(" · ")}</span>
        </Tooltip>
      )}
      <UsageEstimateLine estimate={estimate} compact />
    </ItemCard>
  );
}

/**
 * The Initiatives being shaped, oldest first (the user's request of 2026-11-15): each with its
 * Projects, who shapes it, its Tasks so far and how long it has been shaped. One with no Tasks yet
 * is in no Project, so the Project filter always shows it.
 */
function ShapingFeed({
  shaping,
  projects,
  roles,
  clock,
}: {
  readonly shaping: readonly ShapingOnNow[];
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { shows } = useProjectFilter();
  const { shown, elsewhere } = narrowed(shaping, ({ projectIds }) => shows(projectIds));
  return (
    <>
      {shown.length === 0 && <EmptyCard>Nothing is being shaped in these Projects.</EmptyCard>}
      {shown.map((initiative) => (
        <ShapingCard
          key={initiative.initiativeId}
          initiative={initiative}
          projects={projects}
          roles={roles}
          clock={clock}
        />
      ))}
      <InOtherProjectsNote count={elsewhere} one="Initiative" many="Initiatives" />
    </>
  );
}

function ShapingCard({
  initiative,
  projects,
  roles,
  clock,
}: {
  readonly initiative: ShapingOnNow;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { shapedBy } = initiative;
  const person = shapedBy === null ? undefined : roles?.find(({ key }) => key === shapedBy);
  return (
    <ItemCard edge="running" label={`Shaping: ${initiative.title}`}>
      <div className="now-item">
        <div className="now-item-heading">
          <Badge tone="info">Shaping</Badge>
          <Link
            to="/work/initiatives/$initiativeId"
            params={{ initiativeId: initiative.initiativeId }}
            className="now-item-title"
          >
            {initiative.title}
          </Link>
          {initiative.projectIds.map((projectId) => (
            <ProjectChip key={projectId} projectId={projectId} projects={projects} />
          ))}
        </div>
        <div className="now-item-sub">
          {shapedBy === null ? (
            "Nobody shapes Initiatives yet"
          ) : (
            <>
              {person && <PersonAvatar roleKey={person.key} name={person.card.name} size="xs" />}
              {person ? person.card.name : shapedBy}
            </>
          )}
          <span>·</span>
          {taskCountWords(initiative.taskCount)}
          <span>·</span>
          {shapedForWords(initiative.since, clock)}
        </div>
      </div>
    </ItemCard>
  );
}

/** "No Tasks yet", "1 Task", "3 Tasks". */
function taskCountWords(count: number): string {
  if (count === 0) return "No Tasks yet";
  return count === 1 ? "1 Task" : `${count} Tasks`;
}

/** "Shaped for 18 min", "Shaped for 3h 10 min", "Shaped for 2 days". */
function shapedForWords(since: string, clock: Date): string {
  const milliseconds = Math.max(0, clock.getTime() - Date.parse(since));
  const days = Math.floor(milliseconds / 86_400_000);
  if (days === 0) return `Shaped for ${durationWords(milliseconds)}`;
  return days === 1 ? "Shaped for 1 day" : `Shaped for ${days} days`;
}

function SinceYouLeftFeed({
  sinceYouLeft,
  projects,
  clock,
}: {
  readonly sinceYouLeft: SinceYouLeft;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const { shown, elsewhere } = useNarrowedByProject(sinceYouLeft.finished);
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
  const usageWindows = useUsageWindows(now);
  return (
    <p className="now-tokens">
      <TokenCount tokens={now.tokensToday} label="tokens today" strong />
      {usageWindows.map((windows) => (
        <Fragment key={windows.engineId}>
          {" "}
          · <b>{percentWords(windows.fiveHour)}</b> of {fiveHourWindowName(windows)}
        </Fragment>
      ))}
    </p>
  );
}
