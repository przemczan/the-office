import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Pipeline, Project } from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { AddProjectDialog } from "./add-project-dialog.tsx";
import { publishingLabel } from "./project-labels.ts";
import "./projects.css";

/** The Projects The Office works on, a card each, and adding one. */
export function ProjectsPage(): ReactNode {
  const projects = useQuery(projectQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const [adding, setAdding] = useState(false);
  usePageHeading({ title: "Projects", crumb: projects.data && countOf(projects.data) });
  return (
    <div className="projects-page">
      {projects.error && <Alert tone="danger" title={projects.error.message} />}
      <div className="projects-grid">
        {projects.data?.map((project) => (
          <ProjectCard key={project.id} project={project} pipelines={pipelines.data} />
        ))}
        <article className="project-tile add-project-tile">
          <div className="project-tile-head">
            <span className="add-project-icon">
              <Icon name="folder-plus" size={16} />
            </span>
            <div>
              <h2 className="project-tile-name">Add a Project</h2>
              <div className="project-tile-sub">A repository on the workstation</div>
            </div>
          </div>
          <p className="project-tile-text">
            Give its folder, base branch and commands. Script Stages run the commands in each Task's
            worktree.
          </p>
          <div>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add by path
            </Button>
          </div>
        </article>
      </div>
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ProjectCard({
  project,
  pipelines,
}: {
  readonly project: Project;
  readonly pipelines: readonly Pipeline[] | undefined;
}): ReactNode {
  const pipeline = pipelines?.find((candidate) => candidate.id === project.defaultPipeline);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="project-tile project-card"
    >
      <div className="project-tile-head">
        <ProjectMark project={project} size="xl" />
        <div className="project-tile-grow">
          <h2 className="project-tile-name">{project.name}</h2>
          <div className="project-tile-sub project-path">{project.path}</div>
        </div>
      </div>
      <div className="project-tile-sub">
        <Icon name="route" size={13} />
        Default Pipeline {pipeline?.name ?? project.defaultPipeline} ·{" "}
        {publishingLabel(project.publishingMode, project.baseBranch)}
      </div>
    </Link>
  );
}

function countOf(projects: readonly Project[]): string {
  return projects.length === 1 ? "1 Project" : `${projects.length} Projects`;
}
