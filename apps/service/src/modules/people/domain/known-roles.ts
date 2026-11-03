/** The person the user goes to by default, whom other modules treat apart (spec §2.2). */
export const OFFICE_MANAGER = "office-manager";

/** Who shapes Initiatives and is asked first when a Task's work fails (spec §2.2, §2.3). */
export const CTO = "cto";

/** Who onboards and repairs Projects and owns the Pipeline library (spec §2.2). */
export const DEVOPS = "devops";

/**
 * The built-in person who looks after the workstation and The Office (spec §2.2): always there,
 * never hired or let go, and no preset's.
 */
export const CARETAKER = "caretaker";

/**
 * The Roles of spec §2.2's presets, by the key a Role keeps once hired, with their preset titles.
 * Pipelines and Consult values name a Role by its key, also before anyone fills it, so tier 2's
 * Roles are here though tier 1 hires only the first three.
 */
export const KNOWN_ROLES: ReadonlyMap<string, string> = new Map([
  ["planner", "Planner"],
  ["developer", "Developer"],
  ["reviewer", "Reviewer"],
  [CTO, "CTO"],
  [DEVOPS, "Devops"],
  [OFFICE_MANAGER, "Office Manager"],
]);
