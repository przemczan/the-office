/**
 * The office-wide Pipelines and the Project Pipelines alike: a save of an office-wide one changes
 * the Project Pipelines built from it, and both publish the same events.
 */
export const PIPELINES_KEY: readonly unknown[] = ["pipelines"];

export const PROJECT_PIPELINES_KEY: readonly unknown[] = [...PIPELINES_KEY, "project-pipelines"];

export const STAGE_TEMPLATES_KEY: readonly unknown[] = ["stage-templates"];

/**
 * What changes with who fills a Role or holds a duty: the Stage editor's checks and flags, and each
 * Task's Stages, whose Stages naming a duty say who works them. ["tasks"] covers each Task's Stages
 * and their check, kept under the Task's key.
 */
export function staleStaffing(): readonly (readonly unknown[])[] {
  return [
    [...PIPELINES_KEY, "check"],
    [...PROJECT_PIPELINES_KEY, "check"],
    [...STAGE_TEMPLATES_KEY, "check"],
    ["tasks"],
  ];
}
