import type { DutyKey, WorkCascadeLevels } from "../../people/index.js";

/** The Roles and duties Agent Stages name; a duty is weighed by its holder's Role. */
export interface StageRolesNamed {
  readonly roleKeys: readonly string[];
  readonly dutyKeys: readonly DutyKey[];
}

/**
 * Roles and duties a save of Stages newly names in Agent Stages, and the Project their sessions
 * run in. A duty is weighed by its holder's Role.
 */
export interface NewlyNamedStageRoles extends StageRolesNamed {
  /** A Task's Project; undefined for the library, whose Pipelines run in any Project. */
  readonly projectId: string | undefined;
  /**
   * For a Task's own Stages: the Task, and whom its Agent Stages name before the save and after,
   * weighed at the Task's engine, or its Initiative's, while either sets one.
   */
  readonly task?: {
    readonly taskId: string;
    readonly before: StageRolesNamed;
    readonly after: StageRolesNamed;
  };
}

/**
 * One open Task a change of Tasks' engines moves: whom its Agent Stages name after the change, and
 * its levels.
 */
export interface TaskStageRolesMove extends StageRolesNamed {
  /** Whom they name before, when the change chooses the Task's Pipeline; the same otherwise. */
  readonly namedBefore?: StageRolesNamed;
  readonly projectId: string;
  readonly before: WorkCascadeLevels;
  readonly after: WorkCascadeLevels;
}

/**
 * A change of the engine Tasks run on, a Task's or an Initiative's, in a place named in words
 * ("On “<Task>”", "In <Initiative>").
 */
export interface TaskEnginesChange {
  readonly place: string;
  readonly tasks: readonly TaskStageRolesMove[];
}

/**
 * Whether the engine each Role runs on can work an Agent Stage, which People's engine cascade
 * decides; the composition root binds it to People's capability check (spec §5.4).
 */
export abstract class StageRoleEngines {
  /** Every reason, in the UI's words, the Roles' engines can't; none lets the save through. */
  abstract newlyNamedRolesProblems(roles: NewlyNamedStageRoles): Promise<readonly string[]>;

  /**
   * Every reason, in the UI's words, the Roles the moved Tasks' Stages name would newly land on an
   * engine that can't work an Agent Stage; none lets the change through.
   */
  abstract workLevelsChangeProblems(change: TaskEnginesChange): Promise<readonly string[]>;
}
