import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BoardFilters, TaskSummary } from "@the-office/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { taskQueries } from "../../api/work.ts";
import { boardFilter, boardFiltersOf, withoutBoardFilters } from "./board-filters.ts";
import { boardGroupingOf, createBoardGroupingStore } from "./board-grouping.ts";

export interface BoardFiltering {
  readonly filters: BoardFilters;
  /** Sets the filters in the board's address, keeping what opens over the page and the grouping. */
  readonly change: (filters: BoardFilters) => void;
  /** Whether a Task shows under the filters. */
  readonly shows: (task: TaskSummary) => boolean;
}

/** The board's filters, kept in its address; the search's words are the service's to match. */
export function useBoardFilters(tasks: readonly TaskSummary[]): BoardFiltering {
  const search = useSearch({ from: "/work/" });
  // The address holds the grouping too, which isn't a filter.
  const filters = useMemo(() => boardFiltersOf(search), [search]);
  const navigate = useNavigate();
  const searching = filters.query !== undefined;
  const found = useQuery({
    ...taskQueries.matching(filters.query ?? ""),
    enabled: searching,
    placeholderData: keepPreviousData,
  });
  const foundIds = useMemo(
    () => (searching && found.data ? new Set(found.data.map(({ id }) => id)) : undefined),
    [searching, found.data],
  );
  return {
    filters,
    change: (next) =>
      void navigate({
        to: "/work",
        search: (previous) => ({ ...withoutBoardFilters(previous), ...next }),
        replace: true,
      }),
    shows: boardFilter(filters, tasks, foundIds),
  };
}

export interface BoardGroupingSwitch {
  /** Whether the board is grouped by Initiative. */
  readonly grouped: boolean;
  /** Remembers it in this browser and sets it in the board's address, keeping everything else there. */
  readonly change: (grouped: boolean) => void;
}

const groupingStore = createBoardGroupingStore();

/**
 * Group by Initiative: the board's address says it as `?group=initiative`; an address without
 * `group` follows the choice last made in this browser.
 */
export function useBoardGrouping(): BoardGroupingSwitch {
  const search = useSearch({ from: "/work/" });
  const remembered = useSyncExternalStore(groupingStore.subscribe, groupingStore.current);
  const navigate = useNavigate();
  return {
    // The address only ever holds `group=initiative`, as turning the switch off removes it.
    grouped: boardGroupingOf(search).group === "initiative" || remembered,
    change: (grouped) => {
      groupingStore.remember(grouped);
      void navigate({
        to: "/work",
        // Read as a plain record: the Archive's `kind` and the board's Kind filter share a name.
        search: (previous: Record<string, unknown>) => {
          const { group: _group, ...rest } = previous;
          return { ...rest, ...(grouped && { group: "initiative" as const }) };
        },
        replace: true,
      });
    },
  };
}
