import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Activity, ActivityItem, Project } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { activityQueries } from "../../api/activity.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { Feed, Panel, PanelHeading } from "../../shell/desk.tsx";
import { EmptyCard, ItemCard, type CardEdge } from "../../shell/item-card.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import type { Tone } from "../../shell/tone-words.ts";
import { useClock } from "../../shell/use-clock.ts";
import {
  activityPlaceOf,
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
import { useMarkingSeen } from "./use-marking-seen.ts";
import "./activity.css";

/**
 * Everything The Office is running, by kind, and what ended that the user hasn't seen yet, each
 * marked New until its card has been looked at (spec 2.14); narrowed by the Project filter.
 */
export function ActivityPage(): ReactNode {
  const activity = useQuery(activityQueries.list()).data;
  const projects = useQuery(projectQueries.list()).data;
  const { shows } = useProjectFilter();
  const clock = useClock();
  const { items, unseen, watch } = useItemsThisVisit(activity);
  if (!activity) return <BlockLoader shape="rows" label="Loading Activity…" />;
  const shown = items.filter(({ projectId }) => shows([projectId]));
  const elsewhere = items.length - shown.length;
  const groups = groupedActivity(shown);
  return (
    <div className="activity-page">
      {groups.length === 0 && (
        <EmptyCard>
          <p className="activity-empty-title">
            {elsewhere > 0 ? NOTHING_RUNNING_HERE : NOTHING_RUNNING}
          </p>
          {WHAT_SHOWS_HERE}
        </EmptyCard>
      )}
      {groups.map((grouped) => (
        <ActivityGroupPanel
          key={grouped.group.key}
          grouped={grouped}
          projects={projects}
          clock={clock}
          unseen={unseen}
          watch={watch}
        />
      ))}
      <InOtherProjectsNote count={elsewhere} one="item" many="items" />
    </div>
  );
}

/**
 * The items of the last read, and the ended ones this visit showed before, so a re-read never takes
 * a row from under the reader: one seen here stays, without its New mark, until the next visit.
 */
function useItemsThisVisit(activity: Activity | undefined): {
  readonly items: readonly ActivityItem[];
  readonly unseen: (item: ActivityItem) => boolean;
  readonly watch: (itemId: string) => (card: HTMLElement | null) => void;
} {
  const [endedShown, setEndedShown] = useState<ReadonlyMap<string, ActivityItem>>(new Map());
  const [lastRead, setLastRead] = useState<Activity>();
  const [seenHere, setSeenHere] = useState<ReadonlySet<string>>(new Set());
  const watch = useMarkingSeen((itemId) => setSeenHere((seen) => new Set(seen).add(itemId)));
  if (activity && activity !== lastRead) {
    setLastRead(activity);
    setEndedShown((shown) => withEnded(shown, activity.items));
  }
  const read = activity?.items ?? [];
  const inRead = new Set(read.map(({ id }) => id));
  const items = [...read, ...[...endedShown.values()].filter(({ id }) => !inRead.has(id))];
  return {
    items,
    unseen: (item) => item.ended && inRead.has(item.id) && !seenHere.has(item.id),
    watch,
  };
}

function withEnded(
  shown: ReadonlyMap<string, ActivityItem>,
  items: readonly ActivityItem[],
): ReadonlyMap<string, ActivityItem> {
  const ended = items.filter((item) => item.ended && !shown.has(item.id));
  if (ended.length === 0) return shown;
  return new Map([...shown, ...ended.map((item) => [item.id, item] as const)]);
}

function ActivityGroupPanel({
  grouped: { group, items },
  projects,
  clock,
  unseen,
  watch,
}: {
  readonly grouped: GroupedActivity;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
  readonly unseen: (item: ActivityItem) => boolean;
  readonly watch: (itemId: string) => (card: HTMLElement | null) => void;
}): ReactNode {
  return (
    <Panel label={group.title}>
      <PanelHeading icon={group.icon} title={group.title} count={String(items.length)} />
      <Feed>
        {items.map((item) => (
          <ActivityCard
            key={item.id}
            item={item}
            projects={projects}
            clock={clock}
            unseen={unseen(item)}
            watch={watch}
          />
        ))}
      </Feed>
    </Panel>
  );
}

function ActivityCard({
  item,
  projects,
  clock,
  unseen,
  watch,
}: {
  readonly item: ActivityItem;
  readonly projects: readonly Project[] | undefined;
  readonly clock: Date;
  readonly unseen: boolean;
  readonly watch: (itemId: string) => (card: HTMLElement | null) => void;
}): ReactNode {
  const state = stateWords(item);
  const detail = detailWords(item);
  const kind = kindWords(item);
  return (
    <ItemCard
      edge={edgeOf(item, state.tone)}
      label={`${state.label}: ${item.title}`}
      className={unseen ? "activity-card unseen" : "activity-card"}
      ref={unseen ? watch(item.id) : undefined}
    >
      <div className="activity-item">
        <div className="activity-item-heading">
          <PlaceLink place={activityPlaceOf(item)}>{item.title}</PlaceLink>
          <ProjectChip projectId={item.projectId} projects={projects} />
          <Badge size="sm" dot tone={state.tone}>
            {state.label}
          </Badge>
          {kind && <span className="activity-item-kind">{kind}</span>}
          {unseen && (
            <Badge size="sm" tone="accent">
              New
            </Badge>
          )}
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

/** Running items green or amber by their state; ended ones by how they ended. */
function edgeOf(item: ActivityItem, tone: Tone): CardEdge {
  if (tone === "danger") return "failed";
  if (tone === "warning") return "paused";
  return item.ended ? "done" : "running";
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
    case "ci-runs":
      return (
        <>
          <Link to="/work/ci" className={className}>
            {children}
          </Link>
          <CodeHostLink url={place.url} />
        </>
      );
    case "pull-requests":
      return (
        <>
          <Link to="/work/pull-requests" className={className}>
            {children}
          </Link>
          <CodeHostLink url={place.url} />
        </>
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
