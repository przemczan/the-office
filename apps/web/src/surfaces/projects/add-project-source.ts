import type { GitHubRepository, NewProject } from "@the-office/contracts";
import { repositoryNameOf, type ClonedRepository } from "./repository-clone-step.tsx";

export type WhereItIs = "folder" | "git-url" | "github";

export const WHERE_IT_IS_OPTIONS: readonly {
  readonly value: WhereItIs;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "folder", label: "A folder", hint: "A git repository already on this workstation." },
  {
    value: "git-url",
    label: "A git URL",
    hint: "From any git host. The Office clones it into its data folder.",
  },
  {
    value: "github",
    label: "From GitHub",
    hint: "The repositories The Office's GitHub App is installed on. Picking one clones it.",
  },
];

/** What step 1 of Add a Project chose: a folder, or a clone by its git URL or from GitHub. */
export type ProjectSource =
  | { readonly whereItIs: "folder"; readonly path: string }
  | { readonly whereItIs: "git-url"; readonly clone: ClonedRepository }
  | {
      readonly whereItIs: "github";
      readonly clone: ClonedRepository;
      /** The repository picked; unknown only if the list changed under the clone. */
      readonly repository: GitHubRepository | undefined;
    };

export function whereItIsOf(value: string): WhereItIs {
  return WHERE_IT_IS_OPTIONS.find((option) => option.value === value)?.value ?? "folder";
}

/** Tells one source from another, so the form is filled from each once. */
export function sourceKeyOf(source: ProjectSource): string {
  return source.whereItIs === "folder" ? `folder:${source.path}` : `clone:${source.clone.id}`;
}

/** The name the Project takes from its source until the user writes one: its folder's or repository's. */
export function sourceNameOf(source: ProjectSource): string {
  return source.whereItIs === "folder"
    ? folderNameOf(source.path)
    : repositoryNameOf(source.clone.url);
}

function folderNameOf(path: string): string {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .at(-1) ?? ""
  );
}

/** The source's path and Repository URL, and a clone's default branch. */
export function draftFromSource(draft: NewProject, source: ProjectSource): NewProject {
  if (source.whereItIs === "folder") {
    return { ...draft, path: source.path, repositoryUrl: undefined };
  }
  return {
    ...draft,
    path: source.clone.path,
    repositoryUrl: source.clone.url,
    baseBranch: source.clone.defaultBranch,
  };
}
