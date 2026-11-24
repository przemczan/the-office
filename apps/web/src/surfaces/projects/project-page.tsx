import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
  useParams,
  type LinkProps,
} from "@tanstack/react-router";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  type Project,
  type ProjectFeature,
} from "@the-office/contracts";
import { EmptyState, Tabs } from "@the-office/ui";
import { createContext, useContext, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries } from "../../api/projects.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectLogo } from "../../shell/project-logo.tsx";
import { switchedOffWords } from "./feature-words.ts";
import { OnboardingBadge } from "./onboarding-block.tsx";
import { remoteNeedsLine } from "./remote-needs-words.ts";
import "./projects.css";

/**
 * A Project's sections, each a page of its own; Overview keeps the Project's bare address. A
 * section with a `feature` is left out of the tabs while the Project has it switched off.
 */
const SECTIONS = [
  { to: "/projects/$projectId", label: "Overview" },
  { to: "/projects/$projectId/files", label: "Files" },
  { to: "/projects/$projectId/commands", label: "Commands" },
  { to: "/projects/$projectId/environment", label: "Environment" },
  { to: "/projects/$projectId/pipelines", label: "Pipelines" },
  { to: "/projects/$projectId/issues", label: "GitHub issues", feature: "github-issues" },
  {
    to: "/projects/$projectId/run-environment",
    label: "Run environment",
    feature: "run-environment",
  },
  { to: "/projects/$projectId/devices", label: "Devices", feature: "connected-devices" },
  { to: "/projects/$projectId/test-targets", label: "Test targets", feature: "test-targets" },
  { to: "/projects/$projectId/actions", label: "Actions", feature: "actions" },
  { to: "/projects/$projectId/engine", label: "Engine" },
  { to: "/projects/$projectId/skills", label: "Skills" },
  { to: "/projects/$projectId/server-values", label: "Server values" },
  { to: "/projects/$projectId/features", label: "Features" },
  { to: "/projects/$projectId/appearance", label: "Appearance" },
] as const satisfies readonly {
  readonly to: NonNullable<LinkProps["to"]>;
  readonly label: string;
  readonly feature?: ProjectFeature;
}[];

const OpenProjectContext = createContext<Project | undefined>(undefined);

/** The Project whose page is open, for its sections. */
export function useOpenProject(): Project {
  const project = useContext(OpenProjectContext);
  if (project === undefined) throw new Error("No ProjectPage above this component");
  return project;
}

/**
 * A Project's own page, beside the Projects list: its head, the tabs of its sections under it, then
 * the open section. The page is its sections' `page` container, so they lay out by its width.
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
      <ProjectTabs project={project.data} />
      <div className="project-section">
        <OpenProjectContext value={project.data}>
          <OpenSection project={project.data} />
        </OpenProjectContext>
      </div>
    </div>
  );
}

/**
 * packages/ui's Tabs, one per section, each going to its address; a section's tab stays chosen on
 * its own sub-addresses, such as an open Pipeline. Like the links they replace, they drop the
 * search: the shell has already taken in a link's chat and Thread.
 */
function ProjectTabs({ project }: { readonly project: Project }): ReactNode {
  const navigate = useNavigate();
  const params = { projectId: project.id };
  const open = useOpenSection(project.id).to;
  return (
    <div className="project-tabs">
      <Tabs
        tabs={SECTIONS.filter((section) => switchedOn(project, section)).map(({ to, label }) => ({
          value: to,
          label,
        }))}
        value={open}
        onChange={(value) => {
          const picked = SECTIONS.find(({ to }) => to === value);
          if (picked !== undefined && picked.to !== open) {
            void navigate({ to: picked.to, params });
          }
        }}
      />
    </div>
  );
}

type Section = (typeof SECTIONS)[number];

/** The section the address is on; Overview's starts every other one's, so only exactly. */
function useOpenSection(projectId: string): Section {
  const matchRoute = useMatchRoute();
  const params = { projectId };
  return (
    SECTIONS.slice(1).find(({ to }) => matchRoute({ to, params, fuzzy: true }) !== false) ??
    SECTIONS[0]
  );
}

/** Whether a section's feature is on; Run environment's tab hides while it is Off. */
function switchedOn(project: Project, section: Section): boolean {
  if (!("feature" in section)) return true;
  // Connected devices read off while Run environment isn't On, which the section itself says.
  if (section.feature === "connected-devices") {
    return project.runEnvironment !== "on" || project.features["connected-devices"];
  }
  return project.features[section.feature];
}

/**
 * The open section, or, at the address of one whose feature is switched off, a note saying so with
 * a link to Features; it doesn't redirect.
 */
function OpenSection({ project }: { readonly project: Project }): ReactNode {
  const section = useOpenSection(project.id);
  if (!("feature" in section) || switchedOn(project, section)) return <Outlet />;
  return (
    <EmptyState
      icon="toggle-left"
      title={switchedOffWords(section.feature, project.name)}
      action={
        <Link to="/projects/$projectId/features" params={{ projectId: project.id }}>
          Open Features
        </Link>
      }
    />
  );
}

function ProjectHead({ project }: { readonly project: Project }): ReactNode {
  return (
    <header className="project-head">
      <ProjectLogo project={project} />
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
