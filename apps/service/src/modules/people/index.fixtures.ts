import {
  FIRST_CLAUDE_CODE_ENGINE,
  NoEngineListed,
  type Effort,
  type EngineModel,
} from "../engine/index.js";
import type {
  EngineCascade,
  EngineCascadeLocation,
  EngineCascadeWork,
} from "./application/engine-cascade.js";
import {
  NO_STAND_INS,
  type EngineCascadeLevel,
  type EngineInCascade,
  type StandInsApplying,
} from "./domain/engine-cascade.js";
import { consult, type HardSwitchValue } from "./domain/hard-switches.js";
import { DEVOPS } from "./domain/known-roles.js";

export { DutyRepository } from "./ports/duty-repository.js";
export {
  WorkLevelsForTests,
  WorkLevelsForTestsModule,
} from "./ports/known-work-levels.fixtures.js";
export { DutyRepositoryForTests } from "./ports/duty-repository.fixtures.js";
export { OfficeSetupRepository } from "./ports/office-setup-repository.js";
export { RoleRepository } from "./ports/role-repository.js";
export { OfficeSetupRepositoryForTests } from "./ports/office-setup-repository.fixtures.js";
export { aRole } from "./domain/role.fixtures.js";

/**
 * Where an MCP tool the card leaves unset stands, for tests that stand in for People's `SessionRole`:
 * as with no duty set and Devops hired.
 */
export const MCP_TOOL_DEFAULT_STAND_IN: HardSwitchValue = consult(DEVOPS);

/** What a test gives a Role in `EngineCascadeStandIn.set`: an engine and model, and how it works there. */
export type StandInWork = EngineModel &
  Partial<Pick<EngineInCascade, "engineType" | "effort" | "gaveWay">>;

/**
 * The engine cascade as a test sets it, for tests that stand in for People: every Role runs on
 * `officeDefault` unless `setForTask` or `setForInitiative` gave the Task or the Initiative a session
 * is about an engine override, or `set` gave the Role, or it in one Project, an engine and model of
 * its own. Unlike the cascade, where everyone in a place runs on one engine, a Role may be set apart:
 * the Task's engine override, the Initiative's, what `set` gave it in the Project (at the Project
 * level), what `set` gave it everywhere, the Office default. An override is given with the model
 * the test has the person work with on it, as the cascade's would come from the person. Every
 * engine is a Claude Code one unless `set` says otherwise; the effort is `effort` unless `set` or a
 * Stage's own effort says otherwise. The Stand-in Engine list that applies is `standIns` (the
 * Office's, empty) unless `setStandIns` gave the Project one, and none under an engine override.
 * Every location asked is kept in `asked`, for a test to check where a session resolved the cascade.
 */
export class EngineCascadeStandIn implements Pick<EngineCascade, "of" | "applying" | "onEngine"> {
  /** Null only while no engine is listed (`removeEveryEngine`). */
  officeDefault: EngineModel | null = {
    engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    model: "claude-sonnet-5-5",
  };
  /** The effort every person works with unless `set` or a Stage gives another. */
  effort: Effort | null = "high";
  /** The Stand-in Engine list that applies wherever `setStandIns` gave none. */
  standIns: StandInsApplying = { from: "office", engineIds: [] };
  /** Each Role, location and Stage's effort the cascade was asked for, in order. */
  readonly asked: {
    readonly roleKey: string;
    readonly location: EngineCascadeLocation;
    readonly work: EngineCascadeWork;
  }[] = [];
  private readonly overrides = new Map<string, StandInWork>();
  private readonly tasks = new Map<string, EngineModel>();
  private readonly initiatives = new Map<string, EngineModel>();
  private readonly projectStandIns = new Map<string, StandInsApplying>();
  private readonly onEngines = new Map<string, Omit<StandInWork, "engineId">>();

  /** The Role `roleKey` runs on `work`, in the Project `projectId` or in every one. */
  set(roleKey: string, work: StandInWork, projectId?: string): void {
    this.overrides.set(keyOf(roleKey, projectId), work);
  }

  /** The Task `taskId` has an engine override, its person working with `engineModel`'s model; or none again. */
  setForTask(taskId: string, engineModel: EngineModel | null): void {
    if (engineModel === null) this.tasks.delete(taskId);
    else this.tasks.set(taskId, engineModel);
  }

  /** The Initiative `initiativeId` has an engine override, as `setForTask`; or none again. */
  setForInitiative(initiativeId: string, engineModel: EngineModel | null): void {
    if (engineModel === null) this.initiatives.delete(initiativeId);
    else this.initiatives.set(initiativeId, engineModel);
  }

  /** The Project `projectId` uses `standIns`, or what applies everywhere again. */
  setStandIns(projectId: string, standIns: StandInsApplying | null): void {
    if (standIns === null) this.projectStandIns.delete(projectId);
    else this.projectStandIns.set(projectId, standIns);
  }

  /**
   * The Role `roleKey` works with `work` on `engineId` when its session lands there as a Stand-in
   * Engine (`onEngine`); unset, with the cascade's model and effort.
   */
  setOnEngine(roleKey: string, engineId: string, work: Omit<StandInWork, "engineId">): void {
    this.onEngines.set(JSON.stringify([roleKey, engineId]), work);
  }

  /** As removing the only engine leaves it: every level moved to none. */
  removeEveryEngine(): void {
    this.officeDefault = null;
    this.overrides.clear();
    this.tasks.clear();
    this.initiatives.clear();
  }

  async of(
    roleKey: string,
    location: EngineCascadeLocation = {},
    work: EngineCascadeWork = {},
  ): Promise<EngineInCascade> {
    const applying = await this.applying(roleKey, location, work);
    if (applying === null) throw new NoEngineListed();
    return applying;
  }

  applying(
    roleKey: string,
    location: EngineCascadeLocation = {},
    work: EngineCascadeWork = {},
  ): Promise<EngineInCascade | null> {
    this.asked.push({ roleKey, location, work });
    const found = this.found(roleKey, location);
    const overridden = found?.level === "task" || found?.level === "initiative";
    const standIns = overridden
      ? NO_STAND_INS
      : ((location.projectId === undefined
          ? undefined
          : this.projectStandIns.get(location.projectId)) ?? this.standIns);
    return Promise.resolve(found && this.working(found.at, found.level, work, standIns));
  }

  /** As `of`, on `engineId`: what `setOnEngine` gave the Role there, else the cascade's work. */
  async onEngine(
    roleKey: string,
    engineId: string,
    location: EngineCascadeLocation = {},
    work: EngineCascadeWork = {},
  ): Promise<EngineInCascade> {
    const cascade = await this.of(roleKey, location, work);
    const there = this.onEngines.get(JSON.stringify([roleKey, engineId]));
    return there
      ? this.working({ ...there, engineId }, cascade.level, work, cascade.standIns)
      : { ...cascade, engineId };
  }

  private found(
    roleKey: string,
    { projectId, taskId, initiativeId }: EngineCascadeLocation,
  ): { readonly at: StandInWork; readonly level: EngineCascadeLevel } | null {
    const task = taskId === undefined ? undefined : this.tasks.get(taskId);
    if (task) return { at: task, level: "task" };
    // A Task's id wins over an Initiative's, as the cascade's does.
    const initiative =
      taskId !== undefined || initiativeId === undefined
        ? undefined
        : this.initiatives.get(initiativeId);
    if (initiative) return { at: initiative, level: "initiative" };
    const inProject =
      projectId === undefined ? undefined : this.overrides.get(keyOf(roleKey, projectId));
    if (inProject) return { at: inProject, level: "project" };
    const everywhere = this.overrides.get(keyOf(roleKey, undefined));
    if (everywhere) return { at: everywhere, level: "office" };
    return this.officeDefault && { at: this.officeDefault, level: "office" };
  }

  private working(
    { engineId, model, engineType = "claude-code", effort, gaveWay }: StandInWork,
    level: EngineCascadeLevel,
    { stageEffort }: EngineCascadeWork,
    standIns: StandInsApplying,
  ): EngineInCascade {
    const ownEffort = effort === undefined ? this.effort : effort;
    return {
      engineId,
      model,
      level,
      engineType,
      modelLevel: "person",
      effort: stageEffort ?? ownEffort,
      effortLevel: stageEffort ? "stage" : "person",
      ...(gaveWay !== undefined && { gaveWay }),
      standIns,
    };
  }
}

function keyOf(roleKey: string, projectId: string | undefined): string {
  return JSON.stringify([roleKey, projectId ?? null]);
}
