/** What a folder on the workstation is to git. */
export type FolderInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "not-a-folder" }
  | { readonly kind: "not-a-repository"; /** git's own words. */ readonly detail: string }
  | { readonly kind: "inside-a-repository"; readonly root: string }
  | { readonly kind: "repository" };

/** The Office's own git: the only code that runs git on a Project. */
export abstract class Git {
  /** Whether `path` is the top-level folder of a repository's working tree. */
  abstract inspect(path: string): Promise<FolderInspection>;

  /** Whether the repository at `repositoryPath` has a local branch named `branch`. */
  abstract hasBranch(repositoryPath: string, branch: string): Promise<boolean>;
}
