import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { taskQueries } from "../../api/work.ts";
import { boardFilter, withoutBoardFilters, type BoardFilters } from "./board-filters.ts";

export interface BoardFiltering {
  readonly filters: BoardFilters;
  /** Sets the filters in the board's address, keeping what opens over the page. */
  readonly change: (filters: BoardFilters) => void;
  /** Whether a Task shows under the filters. */
  readonly shows: (task: Task) => boolean;
}

/** The board's filters, kept in its address; the search's words are the service's to match. */
export function useBoardFilters(tasks: readonly Task[]): BoardFiltering {
  const filters = useSearch({ from: "/work/" });
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
