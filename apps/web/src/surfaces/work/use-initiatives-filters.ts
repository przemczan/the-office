import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Initiative } from "@the-office/contracts";
import { useMemo } from "react";
import { initiativeQueries } from "../../api/work.ts";
import { initiativesFiltersOf, type InitiativesFilters } from "./initiative-columns.ts";

export interface InitiativesFiltering {
  readonly filters: InitiativesFilters;
  /** Sets the filters in the tab's address. */
  readonly change: (filters: InitiativesFilters) => void;
  /**
   * Whether an Initiative's name or outcome matches the search, archived ones too; every one while
   * there are no words, or until the service has answered.
   */
  readonly matchesSearch: (initiative: Initiative) => boolean;
}

/** The Initiatives board's filters, kept in its address; the search's words are the service's to match. */
export function useInitiativesFilters(): InitiativesFiltering {
  const search = useSearch({ from: "/work/initiatives" });
  const filters = useMemo(() => initiativesFiltersOf(search), [search]);
  const navigate = useNavigate();
  const searching = filters.query !== undefined;
  const found = useQuery({
    ...initiativeQueries.matching(filters.query ?? ""),
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
        to: "/work/initiatives",
        // Keeps what opens over the page.
        search: ({ query: _query, waiting: _waiting, ...previous }) => ({ ...previous, ...next }),
        replace: true,
      }),
    matchesSearch: ({ id }) => foundIds === undefined || foundIds.has(id),
  };
}
