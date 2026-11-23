import type { Effort, EngineId, EngineKind, EngineModel } from "../../engine/index.js";
import type { PersonEngineSettings } from "./role-card.js";

/** The levels of the engine cascade, least specific first (spec §5.4.5): where a session runs. */
export const ENGINE_CASCADE_LEVELS = [
  "office-default",
  "project-default",
  "initiative-engine",
  "task-engine",
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

/** The engine everyone in a place runs on, the level that gave it, and the stand-ins there. */
export interface EngineInPlace {
  readonly engineId: EngineId;
  readonly level: EngineCascadeLevel;
  readonly standIns: StandInsApplying;
}

/**
 * The Stand-in Engine list that applies in a place (spec §5.4.6), and whose it is: the Project's
 * own while it uses it, else the Office's.
 */
export interface StandInsApplying {
  readonly from: "office" | "project";
  readonly engineIds: readonly EngineId[];
}

/** A Project's own Stand-in Engine list; kept while `useOwnList` is off, unused. */
export interface ProjectStandIns {
  readonly useOwnList: boolean;
  readonly engineIds: readonly EngineId[];
}

/**
 * The one answer to which Stand-in Engine list applies in a place: the Project's own while it uses
 * it, else the Office's, as outside any Project.
 */
export function standInsApplying(
  officeStandIns: readonly EngineId[],
  project: Pick<ProjectCascadeLevels, "standIns"> | undefined,
): StandInsApplying {
  return project?.standIns.useOwnList
    ? { from: "project", engineIds: project.standIns.engineIds }
    : { from: "office", engineIds: officeStandIns };
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
  readonly standIns: StandInsApplying;
}

/** A Project default: an engine type and one of its accounts. */
export interface ProjectDefaultEngine {
  readonly engineType: EngineKind;
  readonly engineId: EngineId;
}

/** A model and an effort, each null for "Engine's default" or the level below. */
export interface ModelAndEffort {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/**
 * A Project's levels of both cascades, which the Projects module keeps (its `ProjectEngine`): the
 * Project default, the force for everyone on the default's engine type, and its setting for each
 * person per engine type.
 */
export interface ProjectCascadeLevels {
  /** Null is "Office's default". */
  readonly default: ProjectDefaultEngine | null;
  /** Null is off; on only while `default` names an engine type. */
  readonly force: ModelAndEffort | null;
  readonly people: readonly {
    readonly roleKey: string;
    readonly engineSettings: PersonEngineSettings;
  }[];
  readonly standIns: ProjectStandIns;
}

/**
 * The levels with the Project default where `move` puts it; the force goes with a default moved to
 * none, as it is on only while the default names an engine type. The Project's own Stand-in Engine
 * list, kept whether used or not, goes through `moveStandIns` when given (an engine's removal,
 * Engine's `standInListWithout`). The settings for people name engine types, so they stay.
 */
export function movedProjectLevels(
  levels: ProjectCascadeLevels,
  move: (reference: ProjectDefaultEngine) => ProjectDefaultEngine | null,
  moveStandIns?: (standIns: readonly EngineId[]) => readonly EngineId[],
): ProjectCascadeLevels {
  const moved = levels.default && move(levels.default);
  return {
    ...levels,
    default: moved,
    force: moved === null ? null : levels.force,
    ...(moveStandIns && {
      standIns: { ...levels.standIns, engineIds: moveStandIns(levels.standIns.engineIds) },
    }),
  };
}

/**
 * The levels a Task or an Initiative sets, which the Work module keeps: a Task's engine, and the
 * engine of the Initiative it is in (or the Initiative's own, for its Threads). They take the
 * Project default's place (spec §5.4.5); the model they still name is never read.
 */
export interface WorkCascadeLevels {
  readonly taskEngine: EngineModel | null;
  readonly initiativeEngine: EngineModel | null;
}

export const NO_WORK_LEVELS: WorkCascadeLevels = { taskEngine: null, initiativeEngine: null };

/** What the engine cascade weighs in a place: in no Project, only the Office level. */
export interface EngineCascadeLevels {
  /** None only while no engine is listed. */
  readonly officeDefault: EngineModel | null;
  /** The Office's Stand-in Engine list, which applies unless the Project uses its own. */
  readonly officeStandIns: readonly EngineId[];
  readonly project?: ProjectCascadeLevels;
  /** A session about a Task or an Initiative. */
  readonly work?: WorkCascadeLevels;
}

/**
 * Where every session in a place runs, whatever its Role: the most specific level set wins; none
 * when no level is, which happens only while no engine is listed, as the Office default is set
 * whenever one is. A Task's and an Initiative's engine take the Project default's place.
 */
export function engineInCascade({
  officeDefault,
  officeStandIns,
  project,
  work,
}: EngineCascadeLevels): EngineInPlace | null {
  const standIns = standInsApplying(officeStandIns, project);
  const at = (level: EngineCascadeLevel, { engineId }: { readonly engineId: EngineId }) => ({
    engineId,
    level,
    standIns,
  });
  if (work?.taskEngine) return at("task-engine", work.taskEngine);
  if (work?.initiativeEngine) return at("initiative-engine", work.initiativeEngine);
  if (project?.default) return at("project-default", project.default);
  return officeDefault && at("office-default", officeDefault);
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
  /** The Stage's own effort, for a Stage run that sets one. */
  readonly stageEffort?: Effort | null;
}

/** A level's value, or "the engine's default" at that level, which a forced unset field is. */
type LevelValue<Value> = Value | null | undefined | typeof ENGINE_DEFAULT;
const ENGINE_DEFAULT = Symbol("engine's default");

/**
 * The model and the effort the person works with on the engine they landed on, each from the most
 * specific level that sets it, apart, least specific first: the engine's default, the person's
 * setting for the type, the Project's setting for the person on the type, the Project's force on
 * its default's engine type only (a field it leaves unset is the engine's default), and the
 * Stage's effort. A model the engine doesn't offer gives way to its default, and an effort the type
 * doesn't take to the level below.
 */
export function workInCascade({
  roleKey,
  engine,
  inPlace,
  person,
  project,
  stageEffort,
}: WorkInCascadeLevels): EngineInCascade {
  const own = person[engine.kind];
  const projectPerson = project?.people.find((each) => each.roleKey === roleKey)?.engineSettings[
    engine.kind
  ];
  const force =
    project?.force && project.default?.engineType === engine.kind ? project.force : undefined;
  const [modelLevel, model] = mostSpecific<string>(
    [
      ["projectForce", force && (force.model ?? ENGINE_DEFAULT)],
      ["projectPerson", projectPerson?.model],
      ["person", own?.model],
    ],
    () => true,
    engine.defaultModel,
  ) ?? ["engine", engine.defaultModel];
  const givesWay = !engine.models.includes(model);
  const [effortLevel, effort] = mostSpecific<Effort | null>(
    [
      ["stage", stageEffort],
      ["projectForce", force && (force.effort ?? ENGINE_DEFAULT)],
      ["projectPerson", projectPerson?.effort],
      ["person", own?.effort],
    ],
    (each) => each !== null && engine.efforts.includes(each),
    engine.defaultEffort,
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
    standIns: inPlace.standIns,
  };
}

/**
 * The first level, most specific first, that sets a value `accepts` takes, or that sets the
 * engine's default, which is `engineDefault` and always taken.
 */
function mostSpecific<Value>(
  levels: readonly (readonly [WorkCascadeLevel, LevelValue<Value>])[],
  accepts: (value: Value) => boolean,
  engineDefault: Value,
): readonly [WorkCascadeLevel, Value] | undefined {
  for (const [level, value] of levels) {
    if (value === ENGINE_DEFAULT) return [level, engineDefault];
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
