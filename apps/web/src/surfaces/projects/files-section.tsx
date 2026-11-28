import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { Project, ProjectBranch, ProjectBranches } from "@the-office/contracts";
import {
  Alert,
  Badge,
  EmptyState,
  GroupedSelect,
  type GroupedSelectGroup,
  type GroupedSelectOption,
} from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { folderOf, nameOf } from "../../shell/repository-files/repository-files-words.ts";
import { RepositoryTree } from "./repository-files/repository-tree.tsx";
import { FilePreview } from "./file-preview.tsx";
import { useOpenProject } from "./project-page.tsx";
import "./files-section.css";

const EVERY_FILE: readonly string[] = [];

/**
 * The Project's files on any branch, as a tree beside the file selected. The branch and the path
 * are the address's, so a link reopens the same file; the base branch's remote is fetched as the
 * section opens.
 */
export function ProjectFilesSection(): ReactNode {
  const project = useOpenProject();
  const { branch, path = "" } = useSearch({ from: "/projects/$projectId/files" });
  const navigate = useNavigate({ from: "/projects/$projectId/files" });
  const branches = useQuery(projectQueries.branches(project.id, { fetch: true }));

  if (branches.error) {
    return <RefusalAlert title="The branches can't be read" error={branches.error} />;
  }
  if (!branches.data) return <p className="files-quiet">Fetching branches…</p>;
  const shown = branchShown(branches.data, branch);
  const choose = (name: string): void =>
    void navigate({
      search: name === branches.data.baseBranch.name ? {} : { branch: name },
      replace: true,
    });
  return (
    <div className="files-section">
      <div className="files-branch">
        <GroupedSelect
          label="Branch"
          placeholder="Choose a branch"
          value={shown?.name ?? ""}
          groups={branchGroups(branches.data)}
          onChange={choose}
        />
      </div>
      {branches.data.fetchProblem !== null && (
        <Alert tone="warning" title="Showing the last commits known on this workstation">
          The branches couldn't be fetched, so newer commits may be missing:{" "}
          {branches.data.fetchProblem}
        </Alert>
      )}
      {shown === undefined ? (
        <Alert tone="warning" title={`${project.name} has no branch ${branch ?? ""}`}>
          It may have been deleted, or not be known on this workstation.{" "}
          <Link to="/projects/$projectId/files" params={{ projectId: project.id }} replace>
            Show {branches.data.baseBranch.name}
          </Link>
        </Alert>
      ) : (
        <FilesOfBranch
          // A path or an unfolded folder on one branch means nothing on the next.
          key={shown.name}
          project={project}
          branch={shown}
          path={path}
          onSelect={(selected) =>
            void navigate({
              search: (search) => ({ ...search, path: selected }),
              replace: true,
            })
          }
        />
      )}
    </div>
  );
}

/** The branch the address names, the base branch when it names none, or undefined when unknown. */
function branchShown(
  branches: ProjectBranches,
  name: string | undefined,
): ProjectBranch | undefined {
  if (name === undefined || name === branches.baseBranch.name) return branches.baseBranch;
  return branches.branches.find((branch) => branch.name === name);
}

function optionOf({ name }: ProjectBranch): GroupedSelectOption {
  return { value: name, label: name };
}

function branchGroups(branches: ProjectBranches): GroupedSelectGroup[] {
  return [
    {
      label: "Base branch",
      options: [
        { ...optionOf(branches.baseBranch), aside: <Badge tone="neutral">base branch</Badge> },
      ],
    },
    {
      label: "Local branches",
      options: branches.branches.filter(({ kind }) => kind === "local").map(optionOf),
    },
    {
      label: "Remote branches",
      options: branches.branches.filter(({ kind }) => kind === "remote").map(optionOf),
    },
  ];
}

function FilesOfBranch({
  project,
  branch,
  path,
  onSelect,
}: {
  readonly project: Project;
  readonly branch: ProjectBranch;
  readonly path: string;
  readonly onSelect: (path: string) => void;
}): ReactNode {
  return (
    <div className="files-browser">
      <div className="files-tree">
        <RepositoryTree
          projectId={project.id}
          commit={branch.commit}
          label={`Files on ${branch.name}`}
          selected={path}
          reveal={path}
          onSelect={onSelect}
        />
      </div>
      <section className="files-preview" aria-label="Preview">
        <PathShown project={project} branch={branch} path={path} />
      </section>
    </div>
  );
}

/** What the path names, told by its folder's entries, which the tree reads too. */
function PathShown({
  project,
  branch,
  path,
}: {
  readonly project: Project;
  readonly branch: ProjectBranch;
  readonly path: string;
}): ReactNode {
  const folder = useQuery({
    ...projectQueries.repositoryFolder(project.id, branch.commit, folderOf(path), EVERY_FILE),
    enabled: path !== "",
  });
  if (path === "") return <NothingSelected />;
  if (folder.error) return <RefusalAlert title="This file can't be read" error={folder.error} />;
  if (!folder.data) return <p className="files-quiet">Reading the folder…</p>;
  const entry = folder.data.entries.find(({ name }) => name === nameOf(path));
  // Past a crowded folder's cut it may still be a file, which the preview tells.
  const leftOut = folder.data.total > folder.data.entries.length;
  if (entry === undefined && !leftOut) {
    return (
      <EmptyState
        icon="file-x"
        title={`No file or folder ${path} on ${branch.name}`}
        description="Select a file in the tree to see it here."
      />
    );
  }
  if (entry?.kind === "folder") return <NothingSelected folder={path} />;
  return <FilePreview project={project} branch={branch} path={path} />;
}

function NothingSelected({ folder }: { readonly folder?: string }): ReactNode {
  return (
    <EmptyState
      icon="file-search"
      title={folder === undefined ? "No file selected" : `${folder} is a folder`}
      description={
        folder === undefined
          ? "Select a file in the tree to see it here."
          : "Select a file in it to see it here."
      }
    />
  );
}
