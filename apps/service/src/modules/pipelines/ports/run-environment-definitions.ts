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
}
