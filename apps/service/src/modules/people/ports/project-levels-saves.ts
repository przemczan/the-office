import type { ProjectCascadeLevels } from "../domain/engine-cascade.js";

/** A save of a Project's levels of the engine cascade: the levels before it and after. */
export interface ProjectLevelsSave {
  readonly projectId: string;
  readonly projectName: string;
  readonly before: ProjectCascadeLevels;
  readonly after: ProjectCascadeLevels;
}

/**
 * Where People registers what refuses a save of a Project's levels. A port rather than the
 * Projects module itself, as `KnownProjectLevels` is: the composition root binds it to Projects'
 * registry of those checks.
 */
export abstract class ProjectLevelsSaves {
  abstract register(check: (save: ProjectLevelsSave) => Promise<readonly string[]>): void;
}
