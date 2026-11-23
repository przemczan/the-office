import type { Effort, EngineId, EngineKind, EngineModel } from "../../engine/index.js";
import type { PersonEngineSettings } from "./role-card.js";

/** The levels of the engine cascade, least specific first (spec §5.4.5): where a session runs. */
export const ENGINE_CASCADE_LEVELS = [
  "office-default",
  "project-default",
  "initiative-engine",
  "task-engine",
  "project-role-override",
] as const;
export type EngineCascadeLevel = (typeof ENGINE_CASCADE_LEVELS)[number];

/**
 * The levels of the model and effort cascade, least specific first (spec §5.4.5): how the person
 * works on the engine the session landed on.
 */
export const WORK_CASCADE_LEVELS = [
  "engine",
  "person",
  "projectPerson",
  "projectForce",
  "stage",
] as const;
export type WorkCascadeLevel = (typeof WORK_CASCADE_LEVELS)[number];

/**
 * The engine a session runs on and the level that gave it. `placeModel` is the model an earlier
 * Project default, Task engine or Initiative engine named with it, which the person's own setting
 * wins over until the Projects' and Work's levels name no model.
 */
export interface EngineInPlace {
  readonly engineId: EngineId;
  readonly level: EngineCascadeLevel;
  readonly placeModel: string | null;
}

/**
 * The engine a session of a Role runs on, with its level, and the model and effort its person works
 * with there, each with its level. `effort` null leaves it to the runtime. `gaveWay` names the model
 * a level set that the engine doesn't offer, which gave way to the engine's default.
 */
export interface EngineInCascade extends EngineModel {
  readonly level: EngineCascadeLevel;
  readonly engineType: EngineKind;
  readonly effort: Effort | null;
  readonly modelLevel: WorkCascadeLevel;
  readonly effortLevel: WorkCascadeLevel;
  readonly gaveWay?: string;
}

/** A Project's levels of the cascade, which the Projects module keeps. */
export interface ProjectCascadeLevels {
  readonly projectDefault: EngineModel | null;
  /** "Use for every Role": the Project default's model for everyone on its engine type. */
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

/** What the engine cascade weighs for one Role: in no Project, only the Office level. */
export interface EngineCascadeLevels {
  /** None only while no engine is listed. */
  readonly officeDefault: EngineModel | null;
  readonly project?: ProjectCascadeLevels;
  /** A session about a Task or an Initiative. */
  readonly work?: WorkCascadeLevels;
}

/**
 * Where a session of the Role `roleKey` runs: the most specific level set wins; none when no level
 * is, which happens only while no engine is listed, as the Office default is set whenever one is.
 * A Task's and an Initiative's engine take the Project default's place.
 */
export function engineInCascade(
  roleKey: string,
  { officeDefault, project, work }: EngineCascadeLevels,
): EngineInPlace | null {
  const projectRoleOverride = project?.roleOverrides.find((each) => each.roleKey === roleKey);
  if (projectRoleOverride) return at("project-role-override", projectRoleOverride, null);
  if (work?.taskEngine) return at("task-engine", work.taskEngine, work.taskEngine.model);
  if (work?.initiativeEngine) {
    return at("initiative-engine", work.initiativeEngine, work.initiativeEngine.model);
  }
  if (project?.projectDefault) {
    return at("project-default", project.projectDefault, project.projectDefault.model);
  }
  return officeDefault && at("office-default", officeDefault, null);
}

/** The engine a session landed on, as the model and effort cascade reads it. */
export interface LandedEngine {
  readonly id: EngineId;
  readonly kind: EngineKind;
  readonly defaultModel: string;
  readonly defaultEffort: Effort | null;
  readonly models: readonly string[];
  readonly efforts: readonly Effort[];
}

/** What the model and effort cascade weighs for one Role on the engine its session landed on. */
export interface WorkInCascadeLevels {
  readonly roleKey: string;
  readonly engine: LandedEngine;
  readonly inPlace: EngineInPlace;
  readonly person: PersonEngineSettings;
  readonly project?: ProjectCascadeLevels;
  /** The engine type of the Project default's engine, which "Use for every Role" holds to. */
  readonly projectDefaultType?: EngineKind;
  /** The Stage's own effort, for a Stage run that sets one. */
  readonly stageEffort?: Effort | null;
}

/**
 * The model and the effort the person works with on the engine they landed on, each from the most
 * specific level that sets it, least specific first: the engine's default, the model an earlier
 * place level named, the person's setting for the type, the Project's Role override, "Use for every
 * Role" on its engine type only, and the Stage's effort. A model the engine doesn't offer gives way
 * to its default, and an effort the type doesn't take to the level below.
 */
export function workInCascade({
  roleKey,
  engine,
  inPlace,
  person,
  project,
  projectDefaultType,
  stageEffort,
}: WorkInCascadeLevels): EngineInCascade {
  const setting = person[engine.kind];
  const projectRoleOverride = project?.roleOverrides.find((each) => each.roleKey === roleKey);
  const force =
    project?.useForEveryRole && project.projectDefault && projectDefaultType === engine.kind
      ? project.projectDefault
      : undefined;
  const [modelLevel, model] = mostSpecific<string>(
    [
      ["projectForce", force?.model],
      ["projectPerson", projectRoleOverride?.model],
      ["person", setting?.model],
      ["engine", inPlace.placeModel],
    ],
    () => true,
  ) ?? ["engine", engine.defaultModel];
  const givesWay = !engine.models.includes(model);
  const [effortLevel, effort] = mostSpecific<Effort>(
    [
      ["stage", stageEffort],
      ["person", setting?.effort],
    ],
    (each) => engine.efforts.includes(each),
  ) ?? ["engine", engine.defaultEffort];
  return {
    engineId: engine.id,
    level: inPlace.level,
    engineType: engine.kind,
    model: givesWay ? engine.defaultModel : model,
    modelLevel: givesWay ? "engine" : modelLevel,
    effort,
    effortLevel,
    ...(givesWay && { gaveWay: model }),
  };
}

/** The first level, most specific first, that sets a value `accepts` takes. */
function mostSpecific<Value>(
  levels: readonly (readonly [WorkCascadeLevel, Value | null | undefined])[],
  accepts: (value: Value) => boolean,
): readonly [WorkCascadeLevel, Value] | undefined {
  for (const [level, value] of levels) {
    if (value !== null && value !== undefined && accepts(value)) return [level, value];
  }
  return undefined;
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
  /** In the order given, only the Projects whose engine, model or effort differs. */
  readonly elsewhereInProjects: readonly (EngineInCascade & { readonly projectId: string })[];
}

/**
 * What the Role card says of both cascades (spec §2.2), from what the Role works with outside any
 * Project and in each Project; a Project where nothing runs is left out.
 */
export function roleEngineCascade(
  outsideProjects: EngineInCascade | null,
  inProjects: readonly { readonly projectId: string; readonly applying: EngineInCascade | null }[],
): RoleEngineCascade {
  return {
    outsideProjects,
    elsewhereInProjects: inProjects.flatMap(({ projectId, applying }) =>
      applying === null || sameWork(applying, outsideProjects) ? [] : [{ projectId, ...applying }],
    ),
  };
}

function sameWork(one: EngineInCascade, other: EngineInCascade | null): boolean {
  return (
    one.engineId === other?.engineId && one.model === other.model && one.effort === other.effort
  );
}

function at(
  level: EngineCascadeLevel,
  { engineId }: EngineModel,
  placeModel: string | null,
): EngineInPlace {
  return { engineId, level, placeModel };
}
