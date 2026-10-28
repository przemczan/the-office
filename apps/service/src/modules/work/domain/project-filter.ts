/**
 * The top bar's Project filter, which a search follows: every Project, or those chosen, never
 * none.
 */
export type ProjectFilter = "all" | readonly string[];

/**
 * Whether the Project filter shows a record in these Projects: one with no Project is always
 * shown, one spanning Projects is shown if any of them is (spec §2.1).
 */
export function isInProjectFilter(projectIds: readonly string[], filter: ProjectFilter): boolean {
  return (
    filter === "all" || projectIds.length === 0 || projectIds.some((id) => filter.includes(id))
  );
}
