import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Initiative, Project, Task } from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  FoldButton,
  Icon,
  IconButton,
  ProgressBar,
  TextButton,
  type MenuItem,
} from "@the-office/ui";
import { useRef, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { archivePeriodQuery, initiativeQueries, taskQueries } from "../../api/work.ts";
import { FloatingMenu } from "../../shell/floating-menu.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { dayOf } from "../../shell/time.ts";
import { useShaper } from "../../shell/work/use-shaper.ts";
import { useWaitingOnYou } from "../../shell/work/waiting-on-you.ts";
import { isArchived } from "../../shell/work/work-words.ts";
import { useDroppedFold } from "./dropped-fold.ts";
import {
  activeEdge,
  archivedCountWords,
  archivedMatchesWords,
  emptyColumnWords,
  endedWords,
  finalCountWords,
  hasInitiativesFilters,
  INITIATIVE_COLUMNS,
  inStateInOrder,
  nothingToCountWords,
  onTheBoard,
  tasksSoFarWords,
  whatMovesNow,
  type InitiativesFilters,
} from "./initiative-columns.ts";
import { InitiativeProjects } from "./initiative-parts.tsx";
import { InitiativePausedBadge } from "./initiative-pause.tsx";
import {
  initiativeProgress,
  initiativeStateName,
  progressWords,
  tasksOfInitiative,
} from "./initiative-words.ts";
import { SearchBox } from "./search-box.tsx";
import { useArchivingInitiative } from "./use-initiative-archive.ts";
import { useInitiativesFilters } from "./use-initiatives-filters.ts";
import { usePeopleWorking, WorkingMark, type PersonWorking } from "./working-mark.tsx";

/** What every card on the board reads, from one read of each list. */
interface BoardReading {
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  /** Who shapes, as a Shaping card says it. */
  readonly shaper: string | undefined;
  readonly waitsOnYou: (task: Task) => boolean;
  readonly peopleWorkingOn: (taskId: string) => readonly PersonWorking[];
}

/**
 * Work › Initiatives (docs/design/initiatives-tab.html, Proposed: Board): Shaping, Active and Done
 * as the Work board's columns, Dropped folded at the foot of Done, for the Projects the Project
 * filter shows. Archived Initiatives have left it, for the Archived tab.
 */
export function InitiativesBoard(): ReactNode {
  const initiatives = useQuery(initiativeQueries.list());
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const period = useQuery(archivePeriodQuery());
  const shaper = useShaper()?.card.name;
  const projectFilter = useProjectFilter();
  const { filters, change, matchesSearch } = useInitiativesFilters();
  const waitsOnYou = useWaitingOnYou();
  const peopleWorkingOn = usePeopleWorking();
  const error = initiatives.error ?? tasks.error ?? period.error;
  if (error) return <Alert tone="danger" title={error.message} />;
  if (!initiatives.data || !tasks.data || !period.data) return null;
  const { archivePeriod } = period.data;
  if (initiatives.data.length === 0) {
    return <EmptyCard>No Initiatives yet. Shape an Idea into one from Ideas.</EmptyCard>;
  }

  const reading: BoardReading = {
    tasks: tasks.data,
    projects: projects.data,
    shaper,
    waitsOnYou,
    peopleWorkingOn,
  };
  const inProjectFilter = ({ projectIds }: Initiative): boolean => projectFilter.shows(projectIds);
  const waitingOnYou = (initiative: Initiative): boolean =>
    tasksOfInitiative(initiative, reading.tasks).some(waitsOnYou);
  const matchesFilters = (initiative: Initiative): boolean =>
    matchesSearch(initiative) && (filters.waiting === undefined || waitingOnYou(initiative));
  const board = onTheBoard(initiatives.data);
  const archivedShown = initiatives.data.filter(
    (initiative) => isArchived(initiative) && inProjectFilter(initiative),
  );

  return (
    <div className="initiatives-board-page">
      <InitiativesFilterBar
        filters={filters}
        waitingCount={
          board.filter(
            (initiative) =>
              inProjectFilter(initiative) && matchesSearch(initiative) && waitingOnYou(initiative),
          ).length
        }
        onChange={change}
      />
      {filters.query !== undefined && (
        <ArchivedMatchesLine
          query={filters.query}
          count={archivedShown.filter(matchesSearch).length}
        />
      )}
      <InOtherProjectsNote
        count={
          board.filter((initiative) => !inProjectFilter(initiative) && matchesFilters(initiative))
            .length
        }
        one="Initiative on the board"
        many="Initiatives on the board"
      />
      <div className="initiatives-board">
        {INITIATIVE_COLUMNS.map((column) => {
          const inState = inStateInOrder(board, column.key);
          const cards = inState.filter(
            (initiative) => inProjectFilter(initiative) && matchesFilters(initiative),
          );
          return (
            <section key={column.key} className="board-column" aria-label={column.label}>
              <h3>
                {column.label}{" "}
                <span className="board-count">{cards.length.toLocaleString("en-US")}</span>
              </h3>
              <div className="board-hint">
                {column.hint(shaper ?? "whoever shapes Initiatives", archivePeriod)}
              </div>
              <div className="board-cards">
                {cards.length > 0 ? (
                  cards.map((initiative) => (
                    <InitiativeCard key={initiative.id} initiative={initiative} reading={reading} />
                  ))
                ) : (
                  <div className="board-empty">
                    {emptyColumnWords(column, inState, inProjectFilter, archivePeriod)}
                  </div>
                )}
              </div>
              {column.key === "done" && (
                <>
                  <DroppedFold
                    dropped={inStateInOrder(board, "dropped").filter(
                      (initiative) => inProjectFilter(initiative) && matchesFilters(initiative),
                    )}
                    reading={reading}
                  />
                  <OpenTheArchive count={archivedShown.length} />
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function InitiativeCard({
  initiative,
  reading,
}: {
  readonly initiative: Initiative;
  readonly reading: BoardReading;
}): ReactNode {
  switch (initiative.state) {
    case "shaping":
      return <ShapingCard initiative={initiative} reading={reading} />;
    case "active":
      return <ActiveCard initiative={initiative} reading={reading} />;
    case "done":
    case "dropped":
      return <EndedCard initiative={initiative} reading={reading} />;
  }
}

/** The name, the card's one link, stretched over it as a Task card's title is. */
function CardTitle({ initiative }: { readonly initiative: Initiative }): ReactNode {
  return (
    <Link
      to="/work/initiatives/$initiativeId"
      params={{ initiativeId: initiative.id }}
      className="board-card-title"
    >
      {initiative.name}
    </Link>
  );
}

function Outcome({ initiative }: { readonly initiative: Initiative }): ReactNode {
  return initiative.outcome === "" ? (
    <span className="initiative-card-outcome unwritten">Outcome not written yet.</span>
  ) : (
    <span className="initiative-card-outcome">{initiative.outcome}</span>
  );
}

function ActiveCard({
  initiative,
  reading,
}: {
  readonly initiative: Initiative;
  readonly reading: BoardReading;
}): ReactNode {
  const initiativeTasks = tasksOfInitiative(initiative, reading.tasks);
  const progress = initiativeProgress(initiativeTasks, reading.tasks);
  const now = whatMovesNow(initiativeTasks, reading.tasks, reading.waitsOnYou);
  const peopleWorking = peopleWorkingOnAny(initiativeTasks, reading.peopleWorkingOn);
  const titleLink = useRef<HTMLAnchorElement>(null);
  const hasFoot =
    now.waitingOnYou > 0 || now.inProgress > 0 || now.blocked > 0 || peopleWorking.length > 0;
  return (
    <article
      className={["board-card", "initiative-card", activeEdge(now)].filter(Boolean).join(" ")}
      aria-label={initiative.name}
    >
      <div className="board-card-head">
        <CardTitle initiative={initiative} />
      </div>
      <div className="board-card-meta">
        <InitiativePausedBadge initiative={initiative} size="sm" />
        <InitiativeProjects initiative={initiative} projects={reading.projects} />
      </div>
      <Outcome initiative={initiative} />
      {progress.counted === 0 ? (
        <span className="initiative-card-nothing">
          <Icon name="triangle-alert" size={13} />
          {nothingToCountWords(initiativeTasks)}
        </span>
      ) : (
        <span className="initiative-card-progress">
          <ProgressBar
            value={progress.done}
            max={progress.counted}
            tone="success"
            size="sm"
            valueLabel=""
          />
          <span>{progressWords(progress)}</span>
        </span>
      )}
      {hasFoot && (
        <div className="board-card-foot">
          {now.waitingOnYou > 0 && (
            <Badge tone="warning" size="sm">
              <Icon name="hand" size={11} />
              {now.waitingOnYou} waiting on you
            </Badge>
          )}
          {now.inProgress > 0 && (
            <span className="initiative-now live">{now.inProgress} in progress</span>
          )}
          {now.blocked > 0 && (
            <span className="initiative-now">
              <Icon name="lock" size={12} />
              {now.blocked} blocked
            </span>
          )}
          {peopleWorking.length > 0 && (
            // Above the title's stretched link for its tooltip, so a press is passed on to the link.
            <span className="board-card-working" onClick={() => titleLink.current?.click()}>
              <WorkingMark people={peopleWorking} />
            </span>
          )}
        </div>
      )}
    </article>
  );
}

/** Everyone working on any of the Tasks, each once. */
function peopleWorkingOnAny(
  tasks: readonly Task[],
  peopleWorkingOn: (taskId: string) => readonly PersonWorking[],
): PersonWorking[] {
  const byRole = new Map<string, PersonWorking>();
  for (const task of tasks) {
    for (const person of peopleWorkingOn(task.id)) byRole.set(person.roleKey, person);
  }
  return [...byRole.values()];
}

function ShapingCard({
  initiative,
  reading,
}: {
  readonly initiative: Initiative;
  readonly reading: BoardReading;
}): ReactNode {
  const count = tasksOfInitiative(initiative, reading.tasks).length;
  return (
    <article className="board-card initiative-card" aria-label={initiative.name}>
      <div className="board-card-head">
        <CardTitle initiative={initiative} />
      </div>
      <div className="board-card-meta">
        <InitiativeProjects initiative={initiative} projects={reading.projects} />
      </div>
      <Outcome initiative={initiative} />
      <div className="board-card-foot">
        <span className="board-card-note">{initiativeStateName("shaping", reading.shaper)}</span>
        <span aria-hidden="true">·</span>
        <span>{tasksSoFarWords(count)}</span>
      </div>
    </article>
  );
}

/** A Done or Dropped Initiative: compact, with its final count, when it ended and its More menu. */
function EndedCard({
  initiative,
  reading,
}: {
  readonly initiative: Initiative;
  readonly reading: BoardReading;
}): ReactNode {
  const progress = initiativeProgress(tasksOfInitiative(initiative, reading.tasks), reading.tasks);
  return (
    <article
      className={`board-card initiative-card ended ${initiative.state === "done" ? "edge-done" : "edge-failed"}`}
      aria-label={initiative.name}
    >
      <div className="board-card-head">
        <CardTitle initiative={initiative} />
        <EndedCardMenu initiative={initiative} />
      </div>
      <div className="board-card-foot">
        <InitiativeProjects initiative={initiative} projects={reading.projects} />
        <span>{finalCountWords(progress)}</span>
        <span className="initiative-ended-when">{endedWords(initiative)}</span>
      </div>
    </article>
  );
}

/** An ended card's More menu, as a Task card's: Open and Archive. */
function EndedCardMenu({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const archiving = useArchivingInitiative();
  const items: MenuItem[] = [
    {
      icon: <Icon name="external-link" size={14} />,
      label: "Open",
      onSelect: () =>
        void navigate({
          to: "/work/initiatives/$initiativeId",
          params: { initiativeId: initiative.id },
        }),
    },
    {
      icon: <Icon name="archive" size={14} />,
      label: "Archive",
      onSelect: () => archiving.mutate(initiative),
    },
  ];
  return (
    <FloatingMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={180}
      trigger={
        <IconButton
          size="xs"
          icon={<Icon name="ellipsis" size={14} />}
          label={`More for ${initiative.name}`}
        />
      }
      items={items}
    />
  );
}

/**
 * Dropped, at the foot of Done: folded at first and as this browser last left it, its line saying
 * how many and the latest; left out with none to show.
 */
function DroppedFold({
  dropped,
  reading,
}: {
  readonly dropped: readonly Initiative[];
  readonly reading: BoardReading;
}): ReactNode {
  const fold = useDroppedFold();
  const [latest] = dropped;
  if (!latest) return null;
  return (
    <div className="initiatives-dropped">
      <FoldButton unfolded={fold.open} className="initiatives-dropped-line" onClick={fold.toggle}>
        <span className="initiatives-dropped-name">
          Dropped <span className="board-count">{dropped.length.toLocaleString("en-US")}</span>
        </span>
        {!fold.open && (
          <span className="initiatives-dropped-latest">
            Latest: {latest.name}
            {latest.endedAt !== null && `, ${dayOf(latest.endedAt)}`}
          </span>
        )}
      </FoldButton>
      {fold.open && (
        <div className="board-cards">
          {dropped.map((initiative) => (
            <EndedCard key={initiative.id} initiative={initiative} reading={reading} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The foot of Done: the archived Initiatives in the Projects shown, and the way to them. */
function OpenTheArchive({ count }: { readonly count: number }): ReactNode {
  if (count === 0) return null;
  return (
    <Link to="/work/archived" search={{ kind: "initiatives" }} className="initiatives-archive-link">
      <Icon name="archive" size={13} />
      <span>{archivedCountWords(count)}</span>
      <strong>Open the archive</strong>
    </Link>
  );
}

/** Under the filter bar while the search matches archived Initiatives too. */
function ArchivedMatchesLine({
  query,
  count,
}: {
  readonly query: string;
  readonly count: number;
}): ReactNode {
  const navigate = useNavigate();
  if (count === 0) return null;
  return (
    <p className="initiatives-archived-matches">
      <Icon name="archive" size={13} />
      <span>{archivedMatchesWords(count, query)}</span>
      <TextButton
        onClick={() =>
          void navigate({
            to: "/work/archived",
            search: { kind: "initiatives", query: query.trim() },
          })
        }
      >
        Search the archive
      </TextButton>
    </p>
  );
}

/** The tab's filters (made as the Work board's first row): search, Waiting on you, and Clear. */
function InitiativesFilterBar({
  filters,
  waitingCount,
  onChange,
}: {
  readonly filters: InitiativesFilters;
  readonly waitingCount: number;
  readonly onChange: (filters: InitiativesFilters) => void;
}): ReactNode {
  return (
    <div className="board-filters" role="search" aria-label="Filter the Initiatives">
      <div className="board-filters-row">
        <SearchBox
          query={filters.query ?? ""}
          label="Search Initiatives"
          placeholder="Search Initiatives and their outcomes"
          onChange={(query) =>
            onChange({ ...filters, query: query.trim() === "" ? undefined : query })
          }
        />
        <button
          type="button"
          className="board-filter-chip"
          aria-pressed={filters.waiting !== undefined}
          onClick={() =>
            onChange({ ...filters, waiting: filters.waiting === undefined ? 1 : undefined })
          }
        >
          <Icon name="hand" size={13} />
          Waiting on you
          <span className="board-filter-chip-count">{waitingCount}</span>
        </button>
        {hasInitiativesFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
