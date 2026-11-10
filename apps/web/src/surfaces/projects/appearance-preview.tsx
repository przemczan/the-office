import type { Project } from "@the-office/contracts";
import { Badge, PALETTES, SegmentedControl, useAppearance, type Palette } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The Project where it shows, drawn by the app's own mark and Logo so it can't drift from them.
 * `project` carries the mark being edited, so the result shows before it is saved. It shows the
 * palette shown until another is picked, on that palette's page with its versions of the images.
 */
export function AppearancePreview({
  project,
  unsaved,
}: {
  readonly project: Project;
  /** The mark shown is a draft. */
  readonly unsaved: boolean;
}): ReactNode {
  const shownPalette = useAppearance().palette;
  const [pickedPalette, setPickedPalette] = useState<Palette>();
  const palette = pickedPalette ?? shownPalette;
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
            options={(Object.keys(PALETTES) as Palette[]).map((id) => ({
              value: id,
              label: PALETTES[id].name,
              title: `Show it in the ${PALETTES[id].name} palette`,
            }))}
            value={palette}
            onChange={(picked) => setPickedPalette(picked as Palette)}
          />
        </span>
      }
    >
      <div className="appearance-samples">
        <Sample label="On its page" palette={palette}>
          <div className="appearance-sample-head">
            <ProjectLogo project={project} size="page" palette={palette} />
            <div className="appearance-sample-words">
              <div className="appearance-sample-name">{project.name}</div>
              <div className="project-head-meta">
                <span className="project-path">{project.path}</span>
                <span>· {project.baseBranch}</span>
              </div>
            </div>
          </div>
        </Sample>
        <Sample label="On the Projects page" palette={palette}>
          <div className="project-tile">
            <div className="project-tile-head">
              <ProjectLogo project={project} size="xl" palette={palette} />
              <div className="project-tile-grow">
                <div className="project-tile-name">{project.name}</div>
                <div className="project-tile-sub project-path">{project.path}</div>
              </div>
            </div>
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
  readonly palette: Palette;
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
