import type { EngineModel } from "../../engine/index.js";

/** The levels of the engine cascade, least specific first (spec §5.4). */
export const ENGINE_CASCADE_LEVELS = [
  "office-default",
  "project-default",
  "initiative-engine",
  "task-engine",
  "role-override",
  "project-role-override",
] as const;
export type EngineCascadeLevel = (typeof ENGINE_CASCADE_LEVELS)[number];

/** The engine and model a session of a Role runs on, and the level they come from. */
export interface EngineInCascade extends EngineModel {
  readonly level: EngineCascadeLevel;
}

/** A Project's levels of the cascade, which the Projects module keeps. */
export interface ProjectCascadeLevels {
  readonly projectDefault: EngineModel | null;
  /** "Use for every Role": the Project default wins over the Office-wide Role overrides. */
  readonly useForEveryRole: boolean;
  readonly roleOverrides: readonly (EngineModel & { readonly roleKey: string })[];
}

/**
 * The levels with the Project default and each Role override where `move` puts them; one moved to
 * none is dropped, and "Use for every Role" goes with the Project default.
 */
export function movedProjectLevels(
  levels: ProjectCascadeLevels,
  move: (reference: EngineModel) => EngineModel | null,
): ProjectCascadeLevels {
  const projectDefault = levels.projectDefault && move(levels.projectDefault);
  return {
    projectDefault,
    useForEveryRole: levels.useForEveryRole && projectDefault !== null,
    roleOverrides: levels.roleOverrides.flatMap((override) => {
      const moved = move(override);
      return moved ? [{ roleKey: override.roleKey, ...moved }] : [];
    }),
  };
}

/**
 * The levels a Task or an Initiative sets, which the Work module keeps: a Task's engine, and the
 * engine of the Initiative it is in (or the Initiative's own, for its Threads). They take the
 * Project default's place (spec §5.4.5).
 */
export interface WorkCascadeLevels {
  readonly taskEngine: EngineModel | null;
  readonly initiativeEngine: EngineModel | null;
}

export const NO_WORK_LEVELS: WorkCascadeLevels = { taskEngine: null, initiativeEngine: null };

/** What the cascade weighs for one Role: in no Project, only the Office levels. */
export interface EngineCascadeLevels {
  /** None only while no engine is listed. */
  readonly officeDefault: EngineModel | null;
  readonly roleOverride: EngineModel | null;
  readonly project?: ProjectCascadeLevels;
  /** A session about a Task or an Initiative. */
  readonly work?: WorkCascadeLevels;
}

/**
 * The most specific level set for the Role `roleKey` wins; none when no level is, which happens
 * only while no engine is listed, as the Office default is set whenever one is. A Task's and an
 * Initiative's engine take the Project default's place, so "Use for every Role", which needs a
 * Project default, lets them win over the Office-wide Role override too.
 */
export function engineInCascade(
  roleKey: string,
  { officeDefault, roleOverride, project, work }: EngineCascadeLevels,
): EngineInCascade | null {
  const projectRoleOverride = project?.roleOverrides.find((each) => each.roleKey === roleKey);
  if (projectRoleOverride) return at("project-role-override", projectRoleOverride);
  if (roleOverride && !project?.useForEveryRole) return at("role-override", roleOverride);
  if (work?.taskEngine) return at("task-engine", work.taskEngine);
  if (work?.initiativeEngine) return at("initiative-engine", work.initiativeEngine);
  if (project?.projectDefault) return at("project-default", project.projectDefault);
  return officeDefault && at("office-default", officeDefault);
}

/** A Project's levels of the cascade, with its id and name. */
export interface ProjectWithCascadeLevels extends ProjectCascadeLevels {
  readonly projectId: string;
  readonly projectName: string;
}

/** What a Role runs on outside any Project, and in each Project where something else applies. */
export interface RoleEngineCascade {
  /** None while no engine is listed. */
  readonly outsideProjects: EngineInCascade | null;
  /** In the order given, only the Projects whose engine or model differs. */
  readonly elsewhereInProjects: readonly (EngineInCascade & { readonly projectId: string })[];
}

/** What the Role card says of the cascade for the Role `roleKey` (spec §2.2). */
export function roleEngineCascade(
  roleKey: string,
  officeLevels: Omit<EngineCascadeLevels, "project">,
  projects: readonly ProjectWithCascadeLevels[],
): RoleEngineCascade {
  const outsideProjects = engineInCascade(roleKey, officeLevels);
  return {
    outsideProjects,
    elsewhereInProjects: projects.flatMap((project) => {
      const applying = engineInCascade(roleKey, { ...officeLevels, project });
      if (applying === null) return [];
      const same =
        applying.engineId === outsideProjects?.engineId && applying.model === outsideProjects.model;
      return same ? [] : [{ projectId: project.projectId, ...applying }];
    }),
  };
}

function at(level: EngineCascadeLevel, { engineId, model }: EngineModel): EngineInCascade {
  return { engineId, model, level };
}
