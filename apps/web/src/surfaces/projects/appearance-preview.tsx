import type { Project } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The Project where it shows, drawn by the app's own mark and Logo so it can't drift from them.
 * `project` carries the mark being edited, so the result shows before it is saved.
 */
export function AppearancePreview({
  project,
  unsaved,
}: {
  readonly project: Project;
  /** The mark shown is a draft. */
  readonly unsaved: boolean;
}): ReactNode {
  return (
    <ProjectBlock
      icon="eye"
      title="How it looks"
      actions={unsaved && <Badge tone="warning" size="sm">Not saved</Badge>}
    >
      <div className="appearance-samples">
        <Sample label="On its page">
          <div className="appearance-sample-head">
            <ProjectLogo project={project} size="page" />
            <div className="appearance-sample-words">
              <div className="appearance-sample-name">{project.name}</div>
              <div className="project-head-meta">
                <span className="project-path">{project.path}</span>
                <span>· {project.baseBranch}</span>
              </div>
            </div>
          </div>
        </Sample>
        <Sample label="On the Projects page">
          <div className="project-tile">
            <div className="project-tile-head">
              <ProjectLogo project={project} size="xl" />
              <div className="project-tile-grow">
                <div className="project-tile-name">{project.name}</div>
                <div className="project-tile-sub project-path">{project.path}</div>
              </div>
            </div>
          </div>
        </Sample>
        <Sample label="Beside an item, as on a Task card">
          <ProjectChip projectId={project.id} projects={[project]} />
        </Sample>
      </div>
    </ProjectBlock>
  );
}

function Sample({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <figure className="appearance-sample">
      <figcaption className="project-row-label">{label}</figcaption>
      <div className="appearance-sample-stage">{children}</div>
    </figure>
  );
}
