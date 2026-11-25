import { useQuery } from "@tanstack/react-query";
import { Outlet, useParams } from "@tanstack/react-router";
import type { Project } from "@the-office/contracts";
import { Alert, Button, EmptyState, Icon } from "@the-office/ui";
import { createContext, useContext, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { AskDevopsButton, useDevops } from "../../shell/ask-devops.tsx";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { SectionLayout, type MenuSection } from "../../shell/section-layout.tsx";
import { AddProjectDialog } from "./add-project-dialog.tsx";
import { ProjectItemLine } from "./project-item-line.tsx";
import "./projects.css";

/** Opens the Add a Project window, from the list's foot or the empty pane beside it. */
const AddProjectContext = createContext<(() => void) | undefined>(undefined);

/**
 * The Projects The Office works on: an item each, whatever the Project filter shows, with adding one
 * at the list's foot, beside the open Project (spec screens/projects.md).
 */
export function ProjectsPage(): ReactNode {
  const projects = useQuery(projectQueries.list());
  const { projectId } = useParams({ strict: false });
  const [adding, setAdding] = useState(false);
  const openAdding = (): void => setAdding(true);
  return (
    <div className="projects-page">
      {projects.error && <Alert tone="danger" title={projects.error.message} />}
      <SectionLayout
        label="Projects"
        sections={(projects.data ?? []).map(projectItem)}
        size="large"
        narrow="list-or-open"
        showingOpen={projectId !== undefined}
        back={{ label: "All Projects", to: "/projects" }}
        foot={<AddProjectActions addLabel="Add a Project" onAdd={openAdding} />}
      >
        <AddProjectContext value={openAdding}>
          <Outlet />
        </AddProjectContext>
      </SectionLayout>
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function projectItem(project: Project): MenuSection {
  return {
    key: project.id,
    to: "/projects/$projectId",
    params: { projectId: project.id },
    leading: <ProjectMark project={project} size="xl" />,
    label: project.name,
    description: <ProjectItemLine project={project} />,
  };
}

/**
 * Adding a Project: by hand, or by asking Devops to onboard it (or the note while nobody can). The
 * empty pane's words offer Devops first, so its button reads "Add it yourself".
 */
function AddProjectActions({
  addLabel,
  onAdd,
}: {
  readonly addLabel: string;
  readonly onAdd: () => void;
}): ReactNode {
  return (
    <div className="add-project-actions">
      <Button variant="secondary" iconLeft={<Icon name="folder-plus" size={14} />} onClick={onAdd}>
        {addLabel}
      </Button>
      <AskDevopsButton
        label={(name) => `Ask ${name} to onboard one`}
        draft="Can you onboard a new Project? The repository is "
      />
    </div>
  );
}

/** The pane beside the list at the bare /projects, inviting to open a Project or add one. */
export function NoProjectOpen(): ReactNode {
  const projects = useQuery(projectQueries.list());
  const openAdding = useContext(AddProjectContext);
  const devops = useDevops();
  usePageHeading({ title: "Projects", crumb: projects.data && countOf(projects.data) });
  if (openAdding === undefined) throw new Error("No ProjectsPage above NoProjectOpen");
  return (
    <div className="projects-empty-pane">
      <EmptyState
        icon="folder-open"
        title="Open a Project from the list, or add one"
        description={
          devops?.card.capabilities.chat
            ? `${devops.card.name} prepares it until it builds and tests in a fresh worktree, and asks before installing anything. Or give its folder or git URL, base branch and commands yourself.`
            : "Give its folder or git URL, base branch and commands. Script Stages run the commands in each Task's worktree."
        }
        action={<AddProjectActions addLabel="Add it yourself" onAdd={openAdding} />}
      />
    </div>
  );
}

function countOf(projects: readonly Project[]): string {
  return projects.length === 1 ? "1 Project" : `${projects.length} Projects`;
}
