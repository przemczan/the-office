import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { OFFICE_IDENTITY_SETTINGS_PATH, type Project } from "@the-office/contracts";
import { EmptyState } from "@the-office/ui";
import { createContext, useContext, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries } from "../../api/projects.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { SectionLayout, type MenuSection } from "../../shell/section-layout.tsx";
import { OnboardingBadge } from "./onboarding-block.tsx";
import { remoteNeedsLine } from "./remote-needs-words.ts";
import "./projects.css";

/** A Project's sections, each a page of its own; Overview keeps the Project's bare address. */
const SECTIONS: readonly MenuSection[] = [
  {
    to: "/projects/$projectId",
    icon: "layout-dashboard",
    label: "Overview",
    onlyAtItsAddress: true,
  },
  { to: "/projects/$projectId/files", icon: "folder-tree", label: "Files" },
  { to: "/projects/$projectId/commands", icon: "terminal", label: "Commands" },
  { to: "/projects/$projectId/environment", icon: "hard-drive", label: "Environment" },
  { to: "/projects/$projectId/pipelines", icon: "route", label: "Pipelines" },
  { to: "/projects/$projectId/issues", icon: "circle-dot", label: "GitHub issues" },
  { to: "/projects/$projectId/run-environment", icon: "container", label: "Run environment" },
  { to: "/projects/$projectId/test-targets", icon: "flask-conical", label: "Test targets" },
  { to: "/projects/$projectId/engine", icon: "cpu", label: "Engine" },
  { to: "/projects/$projectId/skills", icon: "sparkles", label: "Skills" },
  { to: "/projects/$projectId/server-values", icon: "plug", label: "Server values" },
  { to: "/projects/$projectId/appearance", icon: "palette", label: "Appearance" },
];

const OpenProjectContext = createContext<Project | undefined>(undefined);

/** The Project whose page is open, for its sections. */
export function useOpenProject(): Project {
  const project = useContext(OpenProjectContext);
  if (project === undefined) throw new Error("No ProjectPage above this component");
  return project;
}

/** A Project's own page: its head above the menu of its sections, beside the open one. */
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
      <SectionLayout label="Project" sections={SECTIONS} params={{ projectId }}>
        <OpenProjectContext value={project.data}>
          <Outlet />
        </OpenProjectContext>
      </SectionLayout>
    </div>
  );
}

function ProjectHead({ project }: { readonly project: Project }): ReactNode {
  return (
    <header className="project-head">
      <ProjectLogo project={project} size="page" />
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
