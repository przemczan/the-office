/**
 * A Project's Files: the branch shown, the base branch when none is, and the file or folder
 * selected.
 */
export interface ProjectFilesSearch {
  readonly branch?: string;
  readonly path?: string;
}

/** The address's branch and path, an empty one left out. */
export function projectFilesSearchOf(search: Record<string, unknown>): ProjectFilesSearch {
  const branch = search["branch"];
  const path = search["path"];
  return {
    ...(typeof branch === "string" && branch !== "" && { branch }),
    ...(typeof path === "string" && path !== "" && { path }),
  };
}
