import { useQuery } from "@tanstack/react-query";
import type { RepositoryFolder } from "@the-office/contracts";
import { Alert, Breadcrumbs, EmptyState, Icon, type BreadcrumbItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { emptyFolderWords, leftOutWords, pathIn } from "./repository-files-words.ts";
import "./repository-files.css";

/** A file picked in the browser: its path in the repository, and the commit it was seen at. */
export interface RepositoryFile {
  readonly path: string;
  readonly commit: string;
}

interface RepositoryFileBrowserProps {
  readonly projectId: string;
  /** Only files with these extensions show; none shows every file. Folders always show. */
  readonly extensions: readonly string[];
  readonly selected: RepositoryFile | null;
  readonly onSelect: (file: RepositoryFile | null) => void;
}

/**
 * The files committed on a Project's base branch, a folder at a time. The base branch is fetched as
 * it opens, and every folder is then read from that one commit.
 */
export function RepositoryFileBrowser({
  projectId,
  extensions,
  selected,
  onSelect,
}: RepositoryFileBrowserProps): ReactNode {
  const fetched = useQuery(projectQueries.baseBranchFetch(projectId));
  return (
    <div className="repository-file-browser">
      {fetched.error && (
        <RefusalAlert title="The base branch can't be read" error={fetched.error} />
      )}
      {fetched.isPending && <p className="dialog-text">Fetching the base branch…</p>}
      {fetched.data && (
        <>
          {fetched.data.fetchProblem !== null && (
            <Alert tone="warning" title="Showing the last commit known on this workstation">
              The base branch couldn't be fetched, so newer commits may be missing:{" "}
              {fetched.data.fetchProblem}
            </Alert>
          )}
          <CommitFolders
            projectId={projectId}
            commit={fetched.data.commit}
            extensions={extensions}
            selected={selected}
            onSelect={onSelect}
          />
        </>
      )}
    </div>
  );
}

function CommitFolders({
  projectId,
  commit,
  extensions,
  selected,
  onSelect,
}: RepositoryFileBrowserProps & { readonly commit: string }): ReactNode {
  const [path, setPath] = useState("");
  const folder = useQuery(projectQueries.repositoryFolder(projectId, commit, path, extensions));
  const open = (next: string): void => {
    setPath(next);
    // What is selected stays in sight, so it goes with the folder it is in.
    onSelect(null);
  };
  return (
    <>
      <Breadcrumbs items={breadcrumbsOf(path, open)} style={{ flexWrap: "wrap" }} />
      {folder.error && <RefusalAlert title="This folder can't be read" error={folder.error} />}
      {folder.isPending && <p className="dialog-text">Reading the folder…</p>}
      {folder.data && (
        <FolderEntries
          // A folder already read shows at once: without this it opens where the last one was scrolled.
          key={path}
          folder={folder.data}
          extensions={extensions}
          selectedPath={selected?.path}
          onOpen={open}
          onSelect={(file) => onSelect({ path: file, commit })}
        />
      )}
    </>
  );
}

function breadcrumbsOf(path: string, open: (path: string) => void): BreadcrumbItem[] {
  const names = path === "" ? [] : path.split("/");
  return [
    { label: "Top level", onClick: () => open("") },
    ...names.map((label, index) => ({
      label,
      onClick: () => open(names.slice(0, index + 1).join("/")),
    })),
  ];
}

function FolderEntries({
  folder,
  extensions,
  selectedPath,
  onOpen,
  onSelect,
}: {
  readonly folder: RepositoryFolder;
  readonly extensions: readonly string[];
  readonly selectedPath: string | undefined;
  readonly onOpen: (path: string) => void;
  readonly onSelect: (path: string) => void;
}): ReactNode {
  if (folder.total === 0) {
    return (
      <EmptyState
        compact
        icon="folder"
        title={emptyFolderWords(extensions)}
        description="A file shows here once it is committed on the base branch."
      />
    );
  }
  const leftOut = leftOutWords(folder);
  return (
    <>
      {leftOut !== null && <p className="dialog-text">{leftOut}</p>}
      <ul className="repository-file-list">
        {folder.entries.map((entry) => {
          const path = pathIn(folder.path, entry.name);
          return (
            <li key={entry.name}>
              {entry.kind === "folder" ? (
                <button
                  type="button"
                  className="repository-file-entry"
                  onClick={() => onOpen(path)}
                >
                  <Icon name="folder" />
                  <span>{entry.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="repository-file-entry"
                  aria-pressed={path === selectedPath}
                  onClick={() => onSelect(path)}
                >
                  <Icon name="file" />
                  <span>{entry.name}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
