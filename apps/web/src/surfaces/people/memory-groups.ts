import type { MemoryNote, Project } from "@the-office/contracts";

/** The notes about one Project, or about none in particular, as the Memory tab lists them. */
export interface MemoryGroup {
  /** Undefined for the notes that hold for all Projects. */
  readonly projectId: string | undefined;
  readonly title: string;
  readonly notes: readonly MemoryNote[];
}

export const ALL_PROJECTS = "All Projects";

/**
 * The notes (newest first, as the service gives them) grouped for the tab: the ones for all
 * Projects first, then each Project in the order given, then notes about a Project that is gone.
 */
export function memoryGroups(
  notes: readonly MemoryNote[],
  projects: readonly Pick<Project, "id" | "name">[],
): MemoryGroup[] {
  const known = new Set(projects.map(({ id }) => id));
  const groupOf = (projectId: string | undefined, title: string): MemoryGroup => ({
    projectId,
    title,
    notes: notes.filter((note) => note.projectId === projectId),
  });
  const orphans = [
    ...new Set(
      notes.flatMap(({ projectId }) => (projectId && !known.has(projectId) ? [projectId] : [])),
    ),
  ];
  return [
    groupOf(undefined, ALL_PROJECTS),
    ...projects.map(({ id, name }) => groupOf(id, name)),
    ...orphans.map((id) => groupOf(id, id)),
  ].filter(({ notes: grouped }) => grouped.length > 0);
}
