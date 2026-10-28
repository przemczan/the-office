import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Pipeline, Project } from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { AskDevopsButton, useDevops } from "../../shell/ask-devops.tsx";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { publishingLabel } from "../../shell/project-words.ts";
import { AddProjectDialog } from "./add-project-dialog.tsx";
import { OnboardingBadge } from "./onboarding-block.tsx";
import "./projects.css";

/**
 * The Projects The Office works on, a card each for those the Project filter shows with its
 * onboarding, and adding one: by asking Devops to onboard it, or by hand. The count in the heading
 * is every Project.
 */
export function ProjectsPage(): ReactNode {
  const projects = useQuery(projectQueries.list());
  const pipelines = useQuery(pipelineQueries.list());
  const projectFilter = useProjectFilter();
  const [adding, setAdding] = useState(false);
  const devops = useDevops();
  usePageHeading({ title: "Projects", crumb: projects.data && countOf(projects.data) });
  const { shown, elsewhere } = narrowed(projects.data ?? [], ({ id }) => projectFilter.shows([id]));
  return (
    <div className="projects-page">
      {projects.error && <Alert tone="danger" title={projects.error.message} />}
      <div className="projects-grid">
        {shown.map((project) => (
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
            {devops?.card.capabilities.chat
              ? `${devops.card.name} prepares it until it builds and tests in a fresh worktree, and asks before installing anything. Or give its folder, base branch and commands yourself.`
              : "Give its folder, base branch and commands. Script Stages run the commands in each Task's worktree."}
          </p>
          <div className="add-project-actions">
            <AskDevopsButton
              label={(name) => `Ask ${name} to onboard one`}
              draft="Can you onboard a new Project? The repository is "
            />
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add by path
            </Button>
          </div>
        </article>
      </div>
      <InOtherProjectsNote
        count={elsewhere}
        one="Project"
        many="Projects"
        where="hidden by the Project filter"
      />
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
        <OnboardingBadge projectId={project.id} />
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
