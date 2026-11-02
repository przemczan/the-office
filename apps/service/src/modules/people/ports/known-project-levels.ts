import type { ProjectCascadeLevels, ProjectWithCascadeLevels } from "../domain/engine-cascade.js";

/**
 * Each Project's levels of the engine cascade. A port rather than the Projects module itself,
 * because Projects' saves call back People's capability check (`ProjectLevelsSaves`): the
 * composition root binds it to `ProjectService`, and People never imports Projects.
 */
export abstract class KnownProjectLevels {
  /** Throws when there is no such Project. */
  abstract engineLevelsOf(projectId: string): Promise<ProjectCascadeLevels>;

  abstract engineLevelsOfEveryProject(): Promise<readonly ProjectWithCascadeLevels[]>;
}
