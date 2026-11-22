import type { Project, ProjectImagePalette } from "@the-office/contracts";
import type { ReactNode } from "react";
import { ProjectMark } from "./project-mark.tsx";
import { useShownProjectImage } from "./project-image.ts";

/**
 * A Project's Logo at its own proportions, in the version for the palette, where the Project stands
 * alone: its page and its item in the Projects list. Without one, or when it can't be loaded, the mark in its place.
 */
export function ProjectLogo({
  project,
  size,
  palette,
}: {
  readonly project: Project;
  /** xl on a Project's item in the Projects list, page on its page's head. */
  readonly size: "xl" | "page";
  /** The palette whose version shows, when not the base of the one shown, as in a preview. */
  readonly palette?: ProjectImagePalette;
}): ReactNode {
  const { address, onError } = useShownProjectImage(project.id, project.logo, palette);
  if (address === undefined) return <ProjectMark project={project} size={size} palette={palette} />;
  return (
    <img
      className={`project-logo size-${size}`}
      src={address}
      alt=""
      title={project.name}
      onError={onError}
    />
  );
}
