import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ActivityItem, Project, SubjectActivity } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { activityQueries } from "../../api/activity.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../block-loader.tsx";
import { Feed, Panel, PanelHeading } from "../desk.tsx";
import { EmptyCard, ItemCard, type CardEdge } from "../item-card.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { InOtherProjectsNote } from "../project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";
import type { Tone } from "../tone-words.ts";
import { useClock } from "../use-clock.ts";
import {
  activityPlaceOf,
  placeOfSubject,
  spanWords,
  detailWords,
  groupedActivity,
  inStateWords,
  kindWords,
  NOTHING_RUNNING,
  NOTHING_RUNNING_HERE,
  stateWords,
  WHAT_SHOWS_HERE,
  type ActivityPlace,
  type GroupedActivity,
} from "./activity-words.ts";
import "./activity.css";

/**
 * What The Office is running: the activities, one row per Task, Initiative or chat with active
 * sessions, then the other running work by kind (spec 2.14); narrowed by the Project filter.
 */
export function ActivityFeed(): ReactNode {
  const activity = useQuery(activityQueries.list()).data;
  const projects = useQuery(projectQueries.list()).data;
  const { shows } = useProjectFilter();
  const clock = useClock();
  if (!activity) return <BlockLoader shape="rows" label="Loading Activity…" />;
  // An Initiative's or a chat's activity belongs to no one Project, so the filter keeps it.
  const activities = activity.activities.filter(
    ({ subject }) => subject.kind !== "task" || shows([subject.projectId]),
  );
  const otherWork = activity.otherWork.filter(({ projectId }) => shows([projectId]));
  const elsewhere = activity.count - activities.length - otherWork.length;
  const groups = groupedActivity(otherWork);
  return (
    <div className="activity-feed">
      {activities.length === 0 && groups.length === 0 && (
        <EmptyCard>
          <p className="activity-empty-title">
            {elsewhere > 0 ? NOTHING_RUNNING_HERE : NOTHING_RUNNING}
          </p>
          {WHAT_SHOWS_HERE}
        </EmptyCard>
      )}
      {activities.length > 0 && (
        <Panel label="Sessions">
          <PanelHeading icon="users" title="Sessions" count={String(activities.length)} />
          <Feed>
            {activities.map((subjectActivity) => (
              <SubjectActivityCard
                key={subjectActivity.id}
                activity={subjectActivity}
                projects={projects}
                clock={clock}
              />
            ))}
          </Feed>
        </Panel>
      )}
      {groups.map((grouped) => (
        <ActivityGroupPanel
          key={grouped.group.key}
          grouped={grouped}
          projects={projects}
          clock={clock}
        />
      ))}
      <InOtherProjectsNote count={elsewhere} one="item" many="items" />
    </div>
  );
}

function SubjectActivityCard({
  activity: { subject, since, sessions },
  projects,
  clock,
}: {
  readonly activity: SubjectActivity;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const waiting = sessions.every(({ state }) => state === "waiting");
  const state = waiting ? "Waiting" : "Working";
  return (
    <ItemCard
      edge={waiting ? "paused" : "running"}
      label={`${state}: ${subject.title}`}
      className="activity-card"
    >
      <div className="activity-item">
        <div className="activity-item-heading">
          <PlaceLink place={placeOfSubject(subject)}>{subject.title}</PlaceLink>
          {subject.kind === "task" && (
            <ProjectChip projectId={subject.projectId} projects={projects} />
          )}
          <Badge size="sm" dot tone={waiting ? "warning" : "info"}>
            {state}
          </Badge>
        </div>
        <div className="activity-item-sub">
          <span>{sessions.length === 1 ? "1 session" : `${sessions.length} sessions`}</span>
          <span>·</span>
          <span className="activity-item-time">
            {state} for {spanWords(clock.getTime() - Date.parse(since))}
          </span>
        </div>
      </div>
    </ItemCard>
  );
}

function ActivityGroupPanel({
  grouped: { group, items },
  projects,
  clock,
}: {
  readonly grouped: GroupedActivity;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  return (
    <Panel label={group.title}>
      <PanelHeading icon={group.icon} title={group.title} count={String(items.length)} />
      <Feed>
        {items.map((item) => (
          <ActivityCard key={item.id} item={item} projects={projects} clock={clock} />
        ))}
      </Feed>
    </Panel>
  );
}

function ActivityCard({
  item,
  projects,
  clock,
}: {
  readonly item: ActivityItem;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const state = stateWords(item);
  const detail = detailWords(item);
  const kind = kindWords(item);
  return (
    <ItemCard
      edge={edgeOf(state.tone)}
      label={`${state.label}: ${item.title}`}
      className="activity-card"
    >
      <div className="activity-item">
        <div className="activity-item-heading">
          <PlaceLink place={activityPlaceOf(item)}>{item.title}</PlaceLink>
          <ProjectChip projectId={item.projectId} projects={projects} />
          <Badge size="sm" dot tone={state.tone}>
            {state.label}
          </Badge>
          {kind && <span className="activity-item-kind">{kind}</span>}
        </div>
        <div className="activity-item-sub">
          {detail && (
            <>
              <span>{detail}</span>
              <span>·</span>
            </>
          )}
          <span className="activity-item-time">{inStateWords(item, clock)}</span>
        </div>
      </div>
    </ItemCard>
  );
}

/** Running items green or amber by their state. */
function edgeOf(tone: Tone): CardEdge {
  if (tone === "danger") return "failed";
  if (tone === "warning") return "paused";
  return "running";
}

/** The item's title, opening where it lives, with its page on the code host beside when it has one. */
function PlaceLink({
  place,
  children,
}: {
  readonly place: ActivityPlace;
  readonly children: string;
}): ReactNode {
  const className = "activity-item-title";
  switch (place.kind) {
    case "task":
      return (
        <Link to="/tasks/$taskId" params={{ taskId: place.taskId }} className={className}>
          {children}
        </Link>
      );
    case "initiative":
      return (
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: place.initiativeId }}
          className={className}
        >
          {children}
        </Link>
      );
    case "test-targets":
      return (
        <Link
          to="/projects/$projectId/test-targets"
          params={{ projectId: place.projectId }}
          className={className}
        >
          {children}
        </Link>
      );
    case "environment":
      return (
        <Link
          to="/projects/$projectId/environment"
          params={{ projectId: place.projectId }}
          className={className}
        >
          {children}
        </Link>
      );
    case "actions":
      return (
        <Link
          to="/projects/$projectId/actions/$actionKey"
          params={{ projectId: place.projectId, actionKey: place.actionKey }}
          className={className}
        >
          {children}
        </Link>
      );
    case "ci-runs":
      return (
        <>
          <Link to="/work/ci" className={className}>
            {children}
          </Link>
          <CodeHostLink url={place.url} />
        </>
      );
    case "chat":
      return (
        <Link
          to="/now"
          search={{ chat: place.roleKey, thread: place.threadId }}
          className={className}
        >
          {children}
        </Link>
      );
  }
}

function CodeHostLink({ url }: { readonly url: string }): ReactNode {
  return (
    <a
      className="activity-code-host-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open on the code host"
      title="Open on the code host"
    >
      <Icon name="external-link" size={13} />
    </a>
  );
}
