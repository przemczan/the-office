import type { DutyKey } from "../../people/index.js";

/**
 * Roles and duties a save of Stages newly names in Agent Stages, and the Project their sessions
 * run in. A duty is weighed by its holder's Role.
 */
export interface NewlyNamedStageRoles {
  readonly roleKeys: readonly string[];
  readonly dutyKeys: readonly DutyKey[];
  /** A Task's Project; undefined for the library, whose Pipelines run in any Project. */
  readonly projectId: string | undefined;
}

/**
 * Whether the engine each Role runs on can work an Agent Stage, which People's engine cascade
 * decides; the composition root binds it to People's capability check (spec §5.4).
 */
export abstract class StageRoleEngines {
  /** Every reason, in the UI's words, the Roles' engines can't; none lets the save through. */
  abstract newlyNamedRolesProblems(roles: NewlyNamedStageRoles): Promise<readonly string[]>;
}
