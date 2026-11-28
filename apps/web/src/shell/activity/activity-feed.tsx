import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  ActivityItem,
  ActivityPerson,
  ActivitySession,
  ActivitySubject,
  Project,
  Role,
  SubjectActivity,
} from "@the-office/contracts";
import { Badge, Icon, SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { activityQueries } from "../../api/activity.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../block-loader.tsx";
import { useBrandTone } from "../brand-tone.ts";
import { Feed, Panel, PanelHeading } from "../desk.tsx";
import { EmptyCard, ItemCard, type CardEdge } from "../item-card.tsx";
import { OfficeMark } from "../office-mark.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { roleFirstName, roleName } from "../person-name.ts";
import { ProjectChip } from "../project-chip.tsx";
import { InOtherProjectsNote } from "../project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";
import type { Tone } from "../tone-words.ts";
import { useClock } from "../use-clock.ts";
import { ACTIVITY_GROUPINGS, useActivityGrouping } from "./activity-grouping-store.ts";
import { byPerson, bySubject, personKey } from "./activity-sessions.ts";
import {
  sessionKindWords,
  sessionQuestionWords,
  sessionStateWords,
  sessionTimeWords,
} from "./activity-sessions-words.ts";
import {
  activityPlaceOf,
  placeOfSubject,
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
  const roles = useQuery(roleQueries.list()).data;
  const { shows } = useProjectFilter();
  const clock = useClock();
  const [grouping, chooseGrouping] = useActivityGrouping();
  if (!activity) return <BlockLoader shape="rows" label="Loading Activity…" />;
  // An Initiative's or a chat's activity belongs to no one Project, so the filter keeps it.
  const activities = activity.activities.filter(
    ({ subject }) => subject.kind !== "task" || shows([subject.projectId]),
  );
  const otherWork = activity.otherWork.filter(({ projectId }) => shows([projectId]));
  const elsewhere = activity.count - activities.length - otherWork.length;
  const groups = groupedActivity(otherWork);
  const context = { projects, roles, clock };
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
          <div className="activity-grouping" role="group" aria-label="Group sessions">
            <SegmentedControl
              size="sm"
              options={[...GROUPING_OPTIONS]}
              value={grouping}
              onChange={(value) => {
                const chosen = ACTIVITY_GROUPINGS.find((option) => option === value);
                if (chosen) chooseGrouping(chosen);
              }}
            />
          </div>
          {grouping === "person" ? (
            <SessionsByPerson activities={activities} {...context} />
          ) : (
            <Feed>
              {bySubject(activities).map((subjectActivity) => (
                <SubjectCard
                  key={subjectActivity.id}
                  subject={subjectActivity.subject}
                  sessions={subjectActivity.sessions}
                  showPeople
                  {...context}
                />
              ))}
            </Feed>
          )}
        </Panel>
      )}
      {/* A peer of the Sessions heading, so the outline reads as the drawer's two sections. */}
      {groups.length > 0 && <h2 className="activity-other-work">Other running work</h2>}
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

interface RowContext {
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}

const GROUPING_OPTIONS = [
  { value: "person", label: "By person" },
  { value: "subject", label: "By subject" },
] as const;

function SessionsByPerson({
  activities,
  ...context
}: RowContext & { readonly activities: readonly SubjectActivity[] }): ReactNode {
  return (
    <div className="activity-people">
      {byPerson(activities).map(({ key, person, activities: personActivities }) => (
        <div
          key={key}
          className="activity-person"
          role="group"
          aria-label={personLabel(person, context.roles)}
        >
          <div className="activity-person-heading">
            <PersonMark person={person} roles={context.roles} />
            <span>{personLabel(person, context.roles)}</span>
          </div>
          <Feed>
            {personActivities.map(({ activity, sessions }) => (
              <SubjectCard
                key={activity.id}
                subject={activity.subject}
                sessions={sessions}
                showPeople={false}
                {...context}
              />
            ))}
          </Feed>
        </div>
      ))}
    </div>
  );
}

function personLabel(person: ActivityPerson, roles: readonly Role[] | undefined): string {
  return person.kind === "person" ? roleName(person.roleKey, roles) : "The Office";
}

function PersonMark({
  person,
  roles,
}: {
  readonly person: ActivityPerson;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const tone = useBrandTone();
  if (person.kind === "the-office") return <OfficeMark size={20} tone={tone} />;
  return (
    <PersonAvatar roleKey={person.roleKey} name={roleFirstName(person.roleKey, roles)} size="sm" />
  );
}

/** One subject with the sessions listed on it: all its people, or one person's. */
function SubjectCard({
  subject,
  sessions,
  showPeople,
  projects,
  roles,
  clock,
}: RowContext & {
  readonly subject: ActivitySubject;
  readonly sessions: readonly ActivitySession[];
  readonly showPeople: boolean;
}): ReactNode {
  const waiting = sessions.every(({ state }) => state === "waiting");
  return (
    <ItemCard
      edge={waiting ? "paused" : "running"}
      label={`${waiting ? "Waiting" : "Working"}: ${subject.title}`}
      className="activity-card"
    >
      <div className="activity-item">
        <div className="activity-item-heading">
          <PlaceLink place={placeOfSubject(subject)}>{subject.title}</PlaceLink>
          {subject.kind === "task" && (
            <ProjectChip projectId={subject.projectId} projects={projects} />
          )}
        </div>
        <ul className="activity-sessions">
          {sessions.map((session) => (
            <SessionRow
              key={`${personKey(session.person)}:${session.threadId ?? session.sessionKind}:${session.stageName ?? ""}`}
              session={session}
              showPerson={showPeople}
              roles={roles}
              clock={clock}
            />
          ))}
        </ul>
      </div>
    </ItemCard>
  );
}

function SessionRow({
  session,
  showPerson,
  roles,
  clock,
}: {
  readonly session: ActivitySession;
  readonly showPerson: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly clock: Date;
}): ReactNode {
  const state = sessionStateWords(session);
  const question = sessionQuestionWords(session);
  return (
    <li className="activity-session">
      <div className="activity-item-sub">
        {showPerson && (
          <span className="activity-session-person">
            <PersonMark person={session.person} roles={roles} />
            {personLabel(session.person, roles)}
          </span>
        )}
        <Badge size="sm" dot tone={state.tone}>
          {state.label}
        </Badge>
        <span>{sessionKindWords(session)}</span>
        <span>·</span>
        <span className="activity-item-time">{sessionTimeWords(session, clock)}</span>
      </div>
      {question && <p className="activity-session-question">{question}</p>}
    </li>
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
