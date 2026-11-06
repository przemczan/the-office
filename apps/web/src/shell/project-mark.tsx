import { isCustomMarkColour, type CustomMarkColour, type Project } from "@the-office/contracts";
import type { CSSProperties, ReactNode } from "react";
import { markLabelColour } from "./mark-colours.ts";

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
  const { colour, label } = project.mark;
  const custom = isCustomMarkColour(colour);
  return (
    <span
      className={`project-mark size-${size} colour-${custom ? "custom" : colour}`}
      style={custom ? customColourStyle(colour) : undefined}
      title={project.name}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function customColourStyle(colour: CustomMarkColour): CSSProperties {
  return { "--mark-bg": colour, "--mark-fg": markLabelColour(colour) } as CSSProperties;
}
