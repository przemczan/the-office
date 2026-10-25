import type { Project } from "@the-office/contracts";
import type { ReactNode } from "react";

/**
 * A Project's mark: its short label on its colour, kept in every palette like any logo. Every item
 * shows its Project by it (spec §4).
 */
export function ProjectMark({
  project,
  size = "md",
}: {
  readonly project: Pick<Project, "name" | "mark">;
  /** md beside an item, xl on a Project's card, page on its page's head. */
  readonly size?: "md" | "xl" | "page";
}): ReactNode {
  return (
    <span
      className={`project-mark size-${size} colour-${project.mark.colour}`}
      title={project.name}
      aria-hidden="true"
    >
      {project.mark.label}
    </span>
  );
}
