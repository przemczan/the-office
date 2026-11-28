import type { Project, ProjectImagePalette } from "@the-office/contracts";
import type { ReactNode } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { useShownProjectImage } from "../../shell/project-image.ts";

/**
 * A Project's Logo at its own proportions, in the version for the palette, where the Project stands
 * alone: its page's head. Without one, or when it can't be loaded, the mark in its place.
 */
export function ProjectLogo({
  project,
  palette,
}: {
  readonly project: Project;
  /** The palette whose version shows, when not the base of the one shown, as in a preview. */
  readonly palette?: ProjectImagePalette;
}): ReactNode {
  const { address, onError } = useShownProjectImage(project.id, project.logo, palette);
  if (address === undefined) return <ProjectMark project={project} size="page" palette={palette} />;
  return (
    <img className="project-logo" src={address} alt="" title={project.name} onError={onError} />
  );
}
