import type { ProjectCascadeLevels } from "../domain/engine-cascade.js";

/**
 * Each Project's levels of the engine cascade. A port rather than the Projects module itself,
 * because Projects asks People for the Roles when checking a save: the composition root binds it
 * to `ProjectService`, and People never imports Projects.
 */
export abstract class KnownProjectLevels {
  /** Throws when there is no such Project. */
  abstract engineLevelsOf(projectId: string): Promise<ProjectCascadeLevels>;
}
