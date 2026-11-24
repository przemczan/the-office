/** A file of the Run environment definition as an Agent gives it, its path from the repository's root. */
export interface RunEnvironmentDefinitionFile {
  readonly path: string;
  readonly text: string;
}

/** How writing the definition went: the files written and the checks' service, or every problem. */
export type RunEnvironmentDefinitionWriting =
  | { readonly written: true; readonly paths: readonly string[]; readonly service: string }
  | { readonly written: false; readonly problems: readonly string[] };

/**
 * The Run environment definition, which Run environments checks and writes into a worktree's
 * `.devcontainer/` only when it is valid; the composition root binds it.
 */
export abstract class RunEnvironmentDefinitions {
  abstract write(
    worktree: string,
    files: readonly RunEnvironmentDefinitionFile[],
  ): Promise<RunEnvironmentDefinitionWriting>;

  /**
   * Writes the definition as `write` does, then commits only `.devcontainer/` on the Task's branch
   * with `message`, leaving everything else in the worktree as it was. Refused, with nothing
   * written, while `.devcontainer/` has changes not committed yet.
   */
  abstract writeAndCommit(
    worktree: string,
    files: readonly RunEnvironmentDefinitionFile[],
    message: string,
  ): Promise<RunEnvironmentDefinitionCommit>;
}

/** How writing and committing the definition went: as writing it, with the commit when written. */
export type RunEnvironmentDefinitionCommit =
  | {
      readonly written: true;
      readonly paths: readonly string[];
      readonly service: string;
      readonly commit: string;
    }
  | { readonly written: false; readonly problems: readonly string[] };
