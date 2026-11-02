import type { EngineModel } from "../../engine/index.js";

/** The levels of the engine cascade, least specific first (spec §5.4). */
export const ENGINE_CASCADE_LEVELS = [
  "office-default",
  "project-default",
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

/** The levels with the Project default and each Role override where `move` puts them. */
export function movedProjectLevels(
  levels: ProjectCascadeLevels,
  move: (reference: EngineModel) => EngineModel,
): ProjectCascadeLevels {
  return {
    projectDefault: levels.projectDefault && move(levels.projectDefault),
    useForEveryRole: levels.useForEveryRole,
    roleOverrides: levels.roleOverrides.map((override) => ({
      roleKey: override.roleKey,
      ...move(override),
    })),
  };
}

/** What the cascade weighs for one Role: in no Project, only the Office levels. */
export interface EngineCascadeLevels {
  readonly officeDefault: EngineModel;
  readonly roleOverride: EngineModel | null;
  readonly project?: ProjectCascadeLevels;
}

/** The most specific level set for the Role `roleKey` wins; the Office default always is. */
export function engineInCascade(
  roleKey: string,
  { officeDefault, roleOverride, project }: EngineCascadeLevels,
): EngineInCascade {
  const projectRoleOverride = project?.roleOverrides.find((each) => each.roleKey === roleKey);
  if (projectRoleOverride) return at("project-role-override", projectRoleOverride);
  if (roleOverride && !project?.useForEveryRole) return at("role-override", roleOverride);
  if (project?.projectDefault) return at("project-default", project.projectDefault);
  return at("office-default", officeDefault);
}

/** A Project's levels of the cascade, with its id and name. */
export interface ProjectWithCascadeLevels extends ProjectCascadeLevels {
  readonly projectId: string;
  readonly projectName: string;
}

/** What a Role runs on outside any Project, and in each Project where something else applies. */
export interface RoleEngineCascade {
  readonly outsideProjects: EngineInCascade;
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
    elsewhereInProjects: projects
      .map((project) => ({
        projectId: project.projectId,
        ...engineInCascade(roleKey, { ...officeLevels, project }),
      }))
      .filter(
        ({ engineId, model }) =>
          engineId !== outsideProjects.engineId || model !== outsideProjects.model,
      ),
  };
}

function at(level: EngineCascadeLevel, { engineId, model }: EngineModel): EngineInCascade {
  return { engineId, model, level };
}
