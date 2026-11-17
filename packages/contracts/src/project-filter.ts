import { z } from "zod";

/** The top bar's Project filter: every Project, or those chosen, never none. */
export const projectFilterSchema = z.union([z.literal("all"), z.array(z.string()).nonempty()]);
export type ProjectFilter = z.infer<typeof projectFilterSchema>;

/**
 * Whether the Project filter shows a record in these Projects: one with no Project is always
 * shown, one spanning Projects is shown if any of them is (prototypes/app/core.js `inScope`).
 */
export function isInProjectFilter(projectIds: readonly string[], filter: ProjectFilter): boolean {
  return (
    filter === "all" || projectIds.length === 0 || projectIds.some((id) => filter.includes(id))
  );
}

/** The Project filter as a query's `project` parameters, one per Project; none is every Project. */
export function projectFilterParamSchema() {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((project): ProjectFilter => {
      const projectIds = typeof project === "string" ? [project] : (project ?? []);
      return projectIds.length === 0 ? "all" : projectIds;
    });
}
