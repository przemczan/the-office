/**
 * The Roles of spec §2.2's presets, by the key a Role keeps once hired, with their preset titles.
 * Pipelines and Consult values name a Role by its key, also before anyone fills it, so tier 2's
 * Roles are here though tier 1 hires only the first three.
 */
export const KNOWN_ROLES: ReadonlyMap<string, string> = new Map([
  ["planner", "Planner"],
  ["developer", "Developer"],
  ["reviewer", "Reviewer"],
  ["cto", "CTO"],
  ["devops", "Devops"],
  ["office-manager", "Office Manager"],
]);
