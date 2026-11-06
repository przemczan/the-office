import { isCustomMarkColour, type CustomMarkColour, type Project } from "@the-office/contracts";
import type { CSSProperties, ReactNode } from "react";
import { markLabelColour } from "./mark-colours.ts";
import { useShownProjectImage } from "./project-image.ts";

/**
 * A Project's mark: its Icon on its colour, or its short label when it has none or the Icon can't
 * be loaded, kept in every palette like any logo. Every item shows its Project by it (spec §4).
 */
export function ProjectMark({
  project,
  size = "md",
}: {
  /** A Project still being added has neither `id` nor `icon`. */
  readonly project: Pick<Project, "name" | "mark"> & Partial<Pick<Project, "id" | "icon">>;
  /** md beside an item, xl on a Project's card, page on its page's head. */
  readonly size?: "md" | "xl" | "page";
}): ReactNode {
  const { colour, label } = project.mark;
  const { address, onError } = useShownProjectImage(project.id, project.icon);
  const custom = isCustomMarkColour(colour);
  return (
    <span
      className={`project-mark size-${size} colour-${custom ? "custom" : colour}`}
      style={custom ? customColourStyle(colour) : undefined}
      title={project.name}
      aria-hidden="true"
    >
      {address === undefined ? label : <img src={address} alt="" onError={onError} />}
    </span>
  );
}

function customColourStyle(colour: CustomMarkColour): CSSProperties {
  return { "--mark-bg": colour, "--mark-fg": markLabelColour(colour) } as CSSProperties;
}
