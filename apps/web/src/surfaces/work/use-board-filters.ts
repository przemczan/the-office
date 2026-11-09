import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BoardFilters, Task } from "@the-office/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { taskQueries } from "../../api/work.ts";
import { boardFilter, boardFiltersOf, withoutBoardFilters } from "./board-filters.ts";
import { boardGroupingOf } from "./board-grouping.ts";

export interface BoardFiltering {
  readonly filters: BoardFilters;
  /** Sets the filters in the board's address, keeping what opens over the page and the grouping. */
  readonly change: (filters: BoardFilters) => void;
  /** Whether a Task shows under the filters. */
  readonly shows: (task: Task) => boolean;
}

/** The board's filters, kept in its address; the search's words are the service's to match. */
export function useBoardFilters(tasks: readonly Task[]): BoardFiltering {
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
  /** Sets it in the board's address, keeping everything else there. */
  readonly change: (grouped: boolean) => void;
}

/** Group by Initiative, kept in the board's address as `?group=initiative`. */
export function useBoardGrouping(): BoardGroupingSwitch {
  const search = useSearch({ from: "/work/" });
  const navigate = useNavigate();
  return {
    grouped: boardGroupingOf(search).group === "initiative",
    change: (grouped) =>
      void navigate({
        to: "/work",
        search: ({ group: _group, ...previous }) => ({
          ...previous,
          ...(grouped && { group: "initiative" as const }),
        }),
        replace: true,
      }),
  };
}
