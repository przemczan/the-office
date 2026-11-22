import type { Project, ProjectImagePalette } from "@the-office/contracts";
import { Badge, PALETTES, SegmentedControl, useAppearance } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { IMAGE_PALETTES } from "../../shell/project-image.ts";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { ProjectBlock } from "./project-block.tsx";
import { ProjectItemLine } from "./project-item-line.tsx";

/**
 * The Project where it shows, drawn by the app's own mark and Logo so it can't drift from them.
 * `project` carries the mark being edited, so the result shows before it is saved. It shows Light or
 * Dark, the images' two versions: the base of the palette shown until the other is picked, on that
 * palette's page with its versions of the images.
 */
export function AppearancePreview({
  project,
  unsaved,
}: {
  readonly project: Project;
  /** The mark shown is a draft. */
  readonly unsaved: boolean;
}): ReactNode {
  const shownBase = useAppearance().base;
  const [pickedPalette, setPickedPalette] = useState<ProjectImagePalette>();
  const palette = pickedPalette ?? shownBase;
  return (
    <ProjectBlock
      icon="eye"
      title="How it looks"
      actions={
        <span className="appearance-preview-actions">
          {unsaved && (
            <Badge tone="warning" size="sm">
              Not saved
            </Badge>
          )}
          <SegmentedControl
            size="sm"
            options={IMAGE_PALETTES.map((id) => ({
              value: id,
              label: PALETTES[id].name,
              title: `Show it in the ${PALETTES[id].name} palette`,
            }))}
            value={palette}
            onChange={(picked) => setPickedPalette(picked as ProjectImagePalette)}
          />
        </span>
      }
    >
      <div className="appearance-samples">
        <Sample label="On its page" palette={palette}>
          <div className="appearance-sample-head">
            <ProjectLogo project={project} palette={palette} />
            <div className="appearance-sample-words">
              <div className="appearance-sample-name">{project.name}</div>
              <div className="project-head-meta">
                <span className="project-path">{project.path}</span>
                <span>· {project.baseBranch}</span>
              </div>
            </div>
          </div>
        </Sample>
        <Sample label="In the Projects list" palette={palette}>
          <div className="appearance-sample-item">
            <ProjectMark project={project} size="xl" palette={palette} />
            <span className="appearance-sample-item-words">
              <span className="appearance-sample-item-name">{project.name}</span>
              <span className="appearance-sample-item-line">
                <ProjectItemLine project={project} />
              </span>
            </span>
          </div>
        </Sample>
        <Sample label="Beside an item, as on a Task card" palette={palette}>
          <ProjectChip projectId={project.id} projects={[project]} palette={palette} />
        </Sample>
      </div>
    </ProjectBlock>
  );
}

function Sample({
  label,
  palette,
  children,
}: {
  readonly label: string;
  readonly palette: ProjectImagePalette;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <figure className="appearance-sample">
      <figcaption className="project-row-label">{label}</figcaption>
      <div className="appearance-sample-stage palette-stage" data-palette-stage={palette}>
        {children}
      </div>
    </figure>
  );
}
