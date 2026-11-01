import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { OFFICE_IDENTITY_SETTINGS_PATH, type Project } from "@the-office/contracts";
import { EmptyState } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries } from "../../api/projects.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { CommandsBlock } from "./commands-block.tsx";
import { DefaultPipelineBlock } from "./default-pipeline-block.tsx";
import { EnvironmentBlock } from "./environment-block.tsx";
import { OnboardingBadge, OnboardingBlock } from "./onboarding-block.tsx";
import { remoteNeedsLine } from "./remote-needs-words.ts";
import { ServerValuesBlock } from "./server-values-block.tsx";
import { SkillsBlock } from "./skills-block.tsx";
import { WorkBlock } from "./work-block.tsx";
import "./projects.css";

/**
 * A Project's own page: its commands, default Pipeline and publishing, its own skills, its
 * onboarding, its environment, and how its Tasks stand.
 */
export function ProjectPage(): ReactNode {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const project = useQuery(projectQueries.one(projectId));
  usePageHeading({
    title: project.data?.name ?? "Projects",
    parent: { label: "Projects", to: "/projects" },
    crumb: project.data?.name,
  });
  if (project.error) return <Missing error={project.error} />;
  if (!project.data) return null;
  return (
    <div className="project-page">
      <ProjectHead project={project.data} />
      <div className="project-columns">
        <div className="project-column">
          <CommandsBlock project={project.data} />
          <DefaultPipelineBlock project={project.data} />
          <SkillsBlock project={project.data} />
          <ServerValuesBlock project={project.data} />
        </div>
        <div className="project-column">
          <OnboardingBlock project={project.data} />
          <EnvironmentBlock project={project.data} />
          <WorkBlock project={project.data} />
        </div>
      </div>
    </div>
  );
}

function ProjectHead({ project }: { readonly project: Project }): ReactNode {
  return (
    <header className="project-head">
      <ProjectMark project={project} size="page" />
      <div>
        <h2>{project.name}</h2>
        <div className="project-head-meta">
          <OnboardingBadge projectId={project.id} />
          <span className="project-path">{project.path}</span>
          <span>· {project.baseBranch}</span>
        </div>
        {project.repositoryUrl !== null && (
          <div className="project-head-meta">
            <span>Repository URL</span>
            <span className="project-path">{project.repositoryUrl}</span>
          </div>
        )}
        <RemoteNeedsNote projectId={project.id} />
      </div>
    </header>
  );
}

/** Which part of the Office identity the base branch's remote needs; nothing without a remote. */
function RemoteNeedsNote({ projectId }: { readonly projectId: string }): ReactNode {
  const remoteNeeds = useQuery(projectQueries.remoteNeeds(projectId));
  if (!remoteNeeds.data) return null;
  const line = remoteNeedsLine(remoteNeeds.data);
  return (
    <p className="project-remote-needs">
      {line.needs}
      {line.missing.map((missing) => (
        <span key={missing} className="project-remote-missing">
          {" "}
          {missing}
        </span>
      ))}
      {line.inSettings && (
        <>
          {" "}
          <Link to={OFFICE_IDENTITY_SETTINGS_PATH}>Settings › Office identity</Link>
        </>
      )}
    </p>
  );
}

function Missing({ error }: { readonly error: Error }): ReactNode {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <div className="project-page">
      <EmptyState
        icon={gone ? "folder-x" : "circle-alert"}
        title={gone ? error.message : "The Project can't be shown."}
        description={gone ? undefined : error.message}
        action={<Link to="/projects">Back to Projects</Link>}
      />
    </div>
  );
}
