import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
  ArchivedInitiative,
  ArchivedInitiativesPage,
  ArchiveStateFilter,
  Project,
} from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Icon,
  Pagination,
  type DataTableColumn,
} from "@the-office/ui";
import { useEffect, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { archivePeriodQuery, initiativeQueries } from "../../api/work.ts";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { dayOf } from "../../shell/time.ts";
import { RestoreInitiativeButton } from "./archive-parts.tsx";
import { monthLineWords, pageCountOf, type ArchivedSearch } from "./archive-words.ts";
import { finalCountWords } from "./initiative-columns.ts";
import { InitiativeProjects } from "./initiative-parts.tsx";
import { INITIATIVE_STATE_TONES, initiativeStateName } from "./initiative-words.ts";
import { SearchBox } from "./search-box.tsx";

const STATE_FILTERS: readonly { readonly value: ArchiveStateFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
];

/**
 * Work › Archived › Initiatives: the archived Initiatives the Project filter shows, the one that
 * ended last on top under a line per month, 25 to a page, read a page at a time from the service;
 * its search, filter and page are kept in the address.
 */
export function ArchivedInitiatives(): ReactNode {
  const search = useSearch({ from: "/work/archived" });
  const navigate = useNavigate();
  const projectFilter = useProjectFilter();
  const projects = useQuery(projectQueries.list());
  const archivePeriod = useQuery(archivePeriodQuery()).data?.archivePeriod;
  const asked = {
    query: search.query ?? "",
    state: search.state ?? "all",
    page: search.page ?? 1,
  } as const;
  const shown = useQuery({
    ...initiativeQueries.archived({ ...asked, projects: projectFilter.filter }),
    placeholderData: keepPreviousData,
  });
  // Only to count those in other Projects, for the note above the table.
  const everywhere = useQuery({
    ...initiativeQueries.archived({ ...asked, page: 1, projects: "all" }),
    enabled: projectFilter.filter !== "all",
    placeholderData: keepPreviousData,
  });
  const change = (next: Omit<ArchivedSearch, "kind">): void =>
    void navigate({
      to: "/work/archived",
      search: ({ query: _query, state: _state, page: _page, ...previous }) => ({
        ...previous,
        kind: "initiatives" as const,
        ...next,
      }),
      replace: true,
    });
  const lastPage = shown.data ? pageCountOf(shown.data.total, shown.data.pageSize) : undefined;
  // A Restore can empty the last page: show the one before it instead.
  useEffect(() => {
    if (lastPage !== undefined && asked.page > lastPage) {
      change({ ...filtersOf(search), ...(lastPage > 1 && { page: lastPage }) });
    }
  });

  if (shown.error) return <Alert tone="danger" title={shown.error.message} />;
  if (!shown.data) return null;
  const page = shown.data;
  const filters = filtersOf(search);
  const hasFilters = filters.query !== undefined || filters.state !== undefined;
  const elsewhere =
    projectFilter.filter === "all" || !everywhere.data ? 0 : everywhere.data.total - page.total;
  return (
    <div className="archived-initiatives">
      <div className="board-filters" role="search" aria-label="Filter the archived Initiatives">
        <div className="board-filters-row">
          <SearchBox
            query={search.query ?? ""}
            label="Search archived Initiatives"
            placeholder="Search archived Initiatives and their outcomes"
            onChange={(query) =>
              change({
                ...filters,
                query: query.trim() === "" ? undefined : query,
                page: undefined,
              })
            }
          />
          <div className="board-filters-group" role="group" aria-label="State">
            {STATE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className="board-filter-chip"
                aria-pressed={asked.state === value}
                onClick={() =>
                  change({
                    ...filters,
                    state: value === "all" ? undefined : value,
                    page: undefined,
                  })
                }
              >
                {label}
                <span className="board-filter-chip-count">
                  {countOf(page, value).toLocaleString("en-US")}
                </span>
              </button>
            ))}
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => change({})}>
              Clear
            </Button>
          )}
        </div>
      </div>
      <InOtherProjectsNote
        count={elsewhere}
        one="archived Initiative"
        many="archived Initiatives"
      />
      <div className="archived-initiatives-table">
        <DataTable
          columns={columnsFor(projects.data)}
          rows={[...page.initiatives]}
          groupOf={(initiative) => monthLineWords(initiative.endedAt)}
          empty={emptyWords(page, filters.query, projectFilter.filter === "all", archivePeriod)}
        />
      </div>
      {lastPage !== undefined && lastPage > 1 && (
        <Pagination
          page={Math.min(asked.page, lastPage)}
          pageCount={lastPage}
          total={page.total}
          pageSize={page.pageSize}
          onPageChange={(next) => change({ ...filters, ...(next > 1 && { page: next }) })}
        />
      )}
      <p className="archived-initiatives-note">
        <Icon name="info" size={13} />
        <span>
          The one that ended last on top, by month. Restore puts an Initiative back on the board, in
          Done or Dropped, for another Archive period; its page and Threads stay readable while it
          is archived.
        </span>
      </p>
    </div>
  );
}

/** The search and the state filter as the address keeps them, without the page. */
function filtersOf({ query, state }: ArchivedSearch): Pick<ArchivedSearch, "query" | "state"> {
  return { ...(query !== undefined && { query }), ...(state !== undefined && { state }) };
}

function countOf(page: ArchivedInitiativesPage, filter: ArchiveStateFilter): number {
  return filter === "all" ? page.counts.done + page.counts.dropped : page.counts[filter];
}

/** Why the table is empty: nothing archived yet, nothing matching, or none in the Projects shown. */
function emptyWords(
  page: ArchivedInitiativesPage,
  query: string | undefined,
  everyProject: boolean,
  archivePeriod: number | undefined,
): string {
  if (query !== undefined) return `No archived Initiative matches “${query.trim()}”.`;
  if (page.counts.done + page.counts.dropped > 0) return "None matches the filters.";
  if (!everyProject) return "None in the Projects shown.";
  const after =
    archivePeriod === undefined
      ? "once its Archive period has passed"
      : `${archivePeriod} ${archivePeriod === 1 ? "day" : "days"} after it ended`;
  return `No archived Initiatives. A Done or Dropped Initiative comes here ${after}, or by Archive in its card's More menu.`;
}

function columnsFor(
  projects: readonly Project[] | undefined,
): DataTableColumn<ArchivedInitiative>[] {
  return [
    {
      key: "initiative",
      header: "Initiative",
      wrap: true,
      render: (initiative) => (
        <span className="archived-initiative-name">
          <Link to="/work/initiatives/$initiativeId" params={{ initiativeId: initiative.id }}>
            {initiative.name}
          </Link>
          <span className="archived-initiative-sub">
            <InitiativeProjects initiative={initiative} projects={projects} />
            <span>
              {finalCountWords({ done: initiative.tasksDone, counted: initiative.tasksCounted })}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      render: (initiative) => (
        <Badge tone={INITIATIVE_STATE_TONES[initiative.state]} size="sm" dot>
          {initiativeStateName(initiative.state, undefined)}
        </Badge>
      ),
    },
    {
      key: "endedAt",
      header: "Ended",
      muted: true,
      render: (initiative) => (initiative.endedAt === null ? "—" : dayOf(initiative.endedAt)),
    },
    {
      key: "restore",
      header: "",
      align: "right",
      render: (initiative) => <RestoreInitiativeButton initiative={initiative} size="sm" />,
    },
  ];
}
