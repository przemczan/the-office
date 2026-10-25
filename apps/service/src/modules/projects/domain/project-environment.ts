/** A variable the Project's commands run with. */
export interface ProjectVariable {
  readonly name: string;
  readonly value: string;
}

/**
 * How the Project's commands and Agents change the variables they inherit (spec §5.5): kept with
 * the Project, outside its checkout, and saved only once the environment check passes with it.
 */
export interface ProjectEnvironment {
  /** Variables set, in this order, over any inherited one of the same name. */
  readonly set: readonly ProjectVariable[];
  /** Inherited variables removed. */
  readonly unset: readonly string[];
  /** Folders put in front of PATH, in this order. */
  readonly prependPath: readonly string[];
}

/** A Project's environment until its first environment check: the inherited one, unchanged. */
export const UNCHANGED_ENVIRONMENT: ProjectEnvironment = { set: [], unset: [], prependPath: [] };
