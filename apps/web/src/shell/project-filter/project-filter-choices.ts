import type { Project, ProjectFilter } from "@the-office/contracts";

/**
 * The filter for those chosen: every Project when none are, or when all The Office has are, so
 * Projects added later show under All projects.
 */
function projectFilterOf(chosen: readonly string[], projectIds: readonly string[]): ProjectFilter {
  const [first, ...rest] = chosen;
  if (first === undefined || projectIds.every((id) => chosen.includes(id))) return "all";
  return [first, ...rest];
}

/** The filter as the Projects stand: those chosen that The Office no longer has are left out. */
export function knownProjectFilter(
  filter: ProjectFilter,
  projectIds: readonly string[],
): ProjectFilter {
  if (filter === "all") return filter;
  return projectFilterOf(
    filter.filter((id) => projectIds.includes(id)),
    projectIds,
  );
}

export function showsProject(filter: ProjectFilter, projectId: string): boolean {
  return filter === "all" || filter.includes(projectId);
}

/** The filter with a Project turned on or off; the last one shown stays on, as none is no choice. */
export function withProjectToggled(
  filter: ProjectFilter,
  projectId: string,
  projectIds: readonly string[],
): ProjectFilter {
  const shown = filter === "all" ? projectIds : filter;
  if (!shown.includes(projectId)) return projectFilterOf([...shown, projectId], projectIds);
  if (shown.length === 1) return filter;
  return projectFilterOf(
    shown.filter((id) => id !== projectId),
    projectIds,
  );
}

/** The one Project shown, which a new record defaults to; undefined while more are. */
export function onlyProjectShown(filter: ProjectFilter): string | undefined {
  return filter !== "all" && filter.length === 1 ? filter[0] : undefined;
}

export function onlyProject(projectId: string, projectIds: readonly string[]): ProjectFilter {
  return projectFilterOf([projectId], projectIds);
}

/** The top bar's label: All projects, the one Project's name, or how many are shown. */
export function projectFilterLabel(
  filter: ProjectFilter,
  projects: readonly Project[] | undefined,
): string {
  const [first, ...others] = filter === "all" ? [] : filter;
  if (first === undefined) return "All projects";
  if (others.length > 0) return `${others.length + 1} projects`;
  return projects?.find(({ id }) => id === first)?.name ?? first;
}

/** "3 more Tasks in other Projects", for records the filter leaves out. */
export function inOtherProjectsWords(
  count: number,
  one: string,
  many: string,
  where = "in other Projects",
): string {
  return `${count} more ${count === 1 ? one : many} ${where}`;
}

export interface Narrowed<T> {
  readonly shown: readonly T[];
  /** How many the filter leaves out. */
  readonly elsewhere: number;
}

/** The records the filter shows, and how many more it leaves out. */
export function narrowed<T>(records: readonly T[], shows: (record: T) => boolean): Narrowed<T> {
  const shown = records.filter(shows);
  return { shown, elsewhere: records.length - shown.length };
}
