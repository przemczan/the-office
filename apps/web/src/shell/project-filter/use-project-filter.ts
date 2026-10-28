import { useQuery } from "@tanstack/react-query";
import { isInProjectFilter, type ProjectFilter } from "@the-office/contracts";
import { useSyncExternalStore } from "react";
import { projectQueries } from "../../api/projects.ts";
import { knownProjectFilter } from "./project-filter-choices.ts";
import { createProjectFilterStore } from "./project-filter-store.ts";

const store = createProjectFilterStore();

export interface ProjectFilterControls {
  /** The filter as the Projects stand. */
  readonly filter: ProjectFilter;
  /** Whether a record in these Projects is shown; one with none always is. */
  readonly shows: (projectIds: readonly string[]) => boolean;
  readonly choose: (filter: ProjectFilter) => void;
  readonly showAllProjects: () => void;
}

/**
 * The top bar's Project filter, which every surface narrows by; Office-wide numbers, the rail
 * badge, the fire alarm and Notifications never do.
 */
export function useProjectFilter(): ProjectFilterControls {
  const stored = useSyncExternalStore(store.subscribe, store.current);
  const projects = useQuery(projectQueries.list());
  // The stored choice is only ever rewritten by the user, so it survives a load that has no
  // Projects yet.
  const filter = projects.data
    ? knownProjectFilter(
        stored,
        projects.data.map(({ id }) => id),
      )
    : stored;
  return {
    filter,
    shows: (projectIds) => isInProjectFilter(projectIds, filter),
    choose: store.choose,
    showAllProjects: () => store.choose("all"),
  };
}
