import type { Project } from "@the-office/contracts";
import { Icon, type Palette } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectMark } from "./project-mark.tsx";

/**
 * Where an item belongs, in words: its Project's mark and name, or Office-wide when it has none.
 * An id The Office no longer knows shows as itself.
 */
export function ProjectChip({
  projectId,
  projects,
  palette,
}: {
  readonly projectId: string | null;
  readonly projects: readonly Project[] | undefined;
  /** The palette whose Icon version shows, when not the one shown. */
  readonly palette?: Palette;
}): ReactNode {
  if (projectId === null) {
    return (
      <span className="project-chip">
        <Icon name="building-2" size={12} />
        Office-wide
      </span>
    );
  }
  const project = projects?.find((candidate) => candidate.id === projectId);
  return (
    <span className="project-chip">
      {project && <ProjectMark project={project} palette={palette} />}
      {project?.name ?? projectId}
    </span>
  );
}
