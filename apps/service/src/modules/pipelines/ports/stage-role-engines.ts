/** Roles a save of Stages newly names in Agent Stages, and the Project their sessions run in. */
export interface NewlyNamedStageRoles {
  readonly roleKeys: readonly string[];
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
