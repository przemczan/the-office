import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { countedTokens, type DaySummary } from "@the-office/contracts";
import { Alert, Badge } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dayQueries, useDayLiveUpdates } from "../../api/days.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { useEveryTask } from "../../api/work.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { TokenCount } from "../../shell/token-count.tsx";
import { clockOf } from "../../shell/time.ts";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { dropReasonWords } from "../../shell/work/drop-reason-field.tsx";
import { DayPicker } from "./day-picker.tsx";
import {
  alsoCounts,
  dayCounts,
  dayHeading,
  dayWords,
  emptyDayWords,
  failedStageWords,
  initiativeTasksWords,
  isCalendarDay,
  isEmptyDay,
  taskDoneWords,
  type AlsoGroup,
  type DayGroup,
} from "./days-words.ts";
import { endedByWords } from "./pull-request-words.ts";
import "./work.css";

const GROUP_IDS: Readonly<Record<DayGroup, string>> = {
  initiatives: "days-initiatives",
  tasks: "days-tasks",
  "pull-requests": "days-pull-requests",
  failed: "days-failed",
};

/**
 * Work › Days: what The Office did on one office day, in the Projects the Project filter shows. The
 * day is in the address (`?day=YYYY-MM-DD`), today when it is left out or isn't a day; which day is
 * today is the service's answer, never this browser's clock. Today's records follow the events;
 * a past day is read once.
 */
export function DaysPage(): ReactNode {
  const { day: asked } = useSearch({ from: "/work/days" });
  const navigate = useNavigate();
  const projectFilter = useProjectFilter();
  const day = asked !== undefined && isCalendarDay(asked) ? asked : undefined;
  const query = useQuery(dayQueries.one(day, projectFilter.filter));
  useDayLiveUpdates();
  const summary = query.data;
  return (
    <div className="days-page">
      <DayPicker
        day={day ?? summary?.day}
        today={summary?.today}
        // Today is left out of the address, so it stays the live view that moves on at midnight.
        onPick={(picked) =>
          void navigate({
            to: "/work/days",
            search: picked === summary?.today ? {} : { day: picked },
          })
        }
      />
      {query.error && <Alert tone="danger" title={query.error.message} />}
      {!summary && !query.error && <BlockLoader shape="rows" label="Loading the day…" />}
      {summary && <DaySummaryView summary={summary} />}
    </div>
  );
}

function DaySummaryView({ summary }: { readonly summary: DaySummary }): ReactNode {
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  const hasDuplicate = summary.failedOrDropped.some(
    ({ dropReason }) => dropReason?.kind === "duplicate",
  );
  const everyTask = useEveryTask({ enabled: hasDuplicate });
  const [opened, setOpened] = useState<AlsoGroup | undefined>(undefined);
  const counts = dayCounts(summary);
  const also = alsoCounts(summary);
  const tokens = summary.tokens;
  return (
    <>
      <h2 className="days-heading">{dayHeading(summary.day, summary.today)}</h2>
      {summary.day !== summary.today && <p className="days-date">{dayWords(summary.day)}</p>}
      <InOtherProjectsNote count={summary.elsewhere} one="record" many="records" />
      {isEmptyDay(summary) ? (
        <div className="empty-card">
          {emptyDayWords(summary.day, summary.today, summary.elsewhere)}
        </div>
      ) : (
        <>
          <p className="days-counts">
            {counts.map(({ group, words }, index) => (
              <span key={group}>
                {index > 0 && " · "}
                <button
                  type="button"
                  className="days-count"
                  onClick={() => document.getElementById(GROUP_IDS[group])?.scrollIntoView?.()}
                >
                  {words}
                </button>
              </span>
            ))}
            {countedTokens(tokens) > 0 && (
              <span>
                {counts.length > 0 && " · "}
                <TokenCount tokens={tokens} label="tokens" />
              </span>
            )}
          </p>
          {summary.initiativesDone.length > 0 && (
            <DayGroupSection
              id={GROUP_IDS.initiatives}
              title="Initiatives done"
              count={summary.initiativesDone.length}
            >
              {summary.initiativesDone.map((initiative) => (
                <li key={initiative.id} className="days-row">
                  <span className="days-row-main">
                    <Link
                      to="/work/initiatives/$initiativeId"
                      params={{ initiativeId: initiative.id }}
                      className="days-row-title"
                    >
                      {initiative.name}
                    </Link>
                    {initiative.projectIds.map((projectId) => (
                      <ProjectChip key={projectId} projectId={projectId} projects={projects} />
                    ))}
                    <span className="days-row-what">
                      {initiativeTasksWords(initiative.taskCount)}
                    </span>
                  </span>
                  <time className="days-row-time" dateTime={initiative.at}>
                    {clockOf(initiative.at)}
                  </time>
                </li>
              ))}
            </DayGroupSection>
          )}
          {summary.tasksDone.length > 0 && (
            <DayGroupSection
              id={GROUP_IDS.tasks}
              title="Tasks done"
              count={summary.tasksDone.length}
            >
              {summary.tasksDone.map((task) => (
                <li key={task.id} className="days-row">
                  <span className="days-row-main">
                    <TaskLink taskId={task.id} title={task.title} />
                    <ProjectChip projectId={task.projectId} projects={projects} />
                    <span className="days-row-what">
                      {taskDoneWords(task.kind, task.pullRequestNumber)}
                    </span>
                  </span>
                  <time className="days-row-time" dateTime={task.at}>
                    {clockOf(task.at)}
                  </time>
                </li>
              ))}
            </DayGroupSection>
          )}
          {summary.pullRequestsMerged.length > 0 && (
            <DayGroupSection
              id={GROUP_IDS["pull-requests"]}
              title="Pull requests merged"
              count={summary.pullRequestsMerged.length}
            >
              {summary.pullRequestsMerged.map((pullRequest) => (
                <li key={`${pullRequest.taskId}-${pullRequest.number}`} className="days-row">
                  <span className="days-row-main">
                    <a
                      href={pullRequest.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="days-row-title"
                    >
                      #{pullRequest.number}
                    </a>
                    <TaskLink taskId={pullRequest.taskId} title={pullRequest.title} />
                    <ProjectChip projectId={pullRequest.projectId} projects={projects} />
                    <span className="days-row-what">
                      Merged {endedByWords(pullRequest.by, roles, signedInUserId)}
                    </span>
                  </span>
                  <time className="days-row-time" dateTime={pullRequest.at}>
                    {clockOf(pullRequest.at)}
                  </time>
                </li>
              ))}
            </DayGroupSection>
          )}
          {summary.failedOrDropped.length > 0 && (
            <DayGroupSection
              id={GROUP_IDS.failed}
              title="Failed or dropped"
              count={summary.failedOrDropped.length}
            >
              {summary.failedOrDropped.map((entry) => {
                const failed = entry.outcome === "failed";
                const dropReason = entry.dropReason;
                const duplicatedId =
                  dropReason?.kind === "duplicate" ? dropReason.taskId : undefined;
                const reason =
                  dropReason === null
                    ? undefined
                    : dropReasonWords(
                        dropReason,
                        everyTask.data?.find(({ id }) => id === duplicatedId),
                      );
                return (
                  <li key={`${entry.taskId}-${entry.at}`} className="days-row">
                    <span className="days-row-main">
                      <Badge tone={failed ? "danger" : "neutral"} size="sm">
                        {failed ? "Failed" : "Dropped"}
                      </Badge>
                      <TaskLink taskId={entry.taskId} title={entry.title} />
                      <ProjectChip projectId={entry.projectId} projects={projects} />
                      {failed && failedStageWords(entry.stageName) && (
                        <span className="days-row-what">{failedStageWords(entry.stageName)}</span>
                      )}
                      {!failed && reason && <span className="days-row-what">{reason}</span>}
                    </span>
                    <time className="days-row-time" dateTime={entry.at}>
                      {clockOf(entry.at)}
                    </time>
                  </li>
                );
              })}
            </DayGroupSection>
          )}
          {also.length > 0 && (
            <div className="days-also">
              <p className="days-also-line">
                <span className="days-also-label">Also that day</span>
                {also.map(({ group, words }, index) => (
                  <span key={group}>
                    {index > 0 && " · "}
                    <button
                      type="button"
                      className="days-count"
                      aria-expanded={opened === group}
                      onClick={() => setOpened(opened === group ? undefined : group)}
                    >
                      {words}
                    </button>
                  </span>
                ))}
              </p>
              {opened === "ideas" && (
                <ul className="days-list" aria-label="Ideas captured">
                  {summary.ideasCaptured.map((idea) => (
                    <li key={idea.id} className="days-row">
                      <span className="days-row-main">
                        <Link
                          to="/work/ideas"
                          search={{ idea: idea.id }}
                          className="days-row-title"
                        >
                          {idea.title}
                        </Link>
                        <ProjectChip projectId={idea.projectId} projects={projects} />
                      </span>
                      <time className="days-row-time" dateTime={idea.at}>
                        {clockOf(idea.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              {opened === "tasks-started" && (
                <ul className="days-list" aria-label="Tasks started">
                  {summary.tasksStarted.map((task) => (
                    <li key={task.id} className="days-row">
                      <span className="days-row-main">
                        <TaskLink taskId={task.id} title={task.title} />
                        <ProjectChip projectId={task.projectId} projects={projects} />
                      </span>
                      <time className="days-row-time" dateTime={task.at}>
                        {clockOf(task.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function DayGroupSection({
  id,
  title,
  count,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="days-group" aria-labelledby={`${id}-heading`} id={id}>
      <h3 className="days-group-heading" id={`${id}-heading`}>
        {title} <span className="days-group-count">{count}</span>
      </h3>
      <ul className="days-list">{children}</ul>
    </section>
  );
}

function TaskLink({
  taskId,
  title,
}: {
  readonly taskId: string;
  readonly title: string;
}): ReactNode {
  return (
    <Link to="/tasks/$taskId" params={{ taskId }} className="days-row-title">
      {title}
    </Link>
  );
}
