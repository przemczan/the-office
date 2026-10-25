import type { Project } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectMark } from "./project-mark.tsx";

/**
 * Where an item belongs, in words: its Project's mark and name, or Office-wide when it has none.
 * An id The Office no longer knows shows as itself.
 */
export function ProjectChip({
  projectId,
  projects,
}: {
  readonly projectId: string | null;
  readonly projects: readonly Project[] | undefined;
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
      {project && <ProjectMark project={project} />}
      {project?.name ?? projectId}
    </span>
  );
}
