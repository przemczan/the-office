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
import type { EngineCascadeLevel, EngineInCascade } from "./domain/engine-cascade.js";
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
 * `officeDefault` unless `set` gave it, or it in one Project, an engine and model of its own, or
 * `setForTask` or `setForInitiative` gave the Task or the Initiative a session is about one. Levels
 * win as the cascade's do: the Project's Role override, then what `set` gave everywhere, the Task's
 * engine, the Initiative's, the Office default (it has no Project default). Every engine is a
 * Claude Code one unless `set` says otherwise; the effort is `effort` unless `set` or a Stage's own
 * effort says otherwise. Every location asked is kept in `asked`, for a test to check where a
 * session resolved the cascade.
 */
export class EngineCascadeStandIn implements Pick<EngineCascade, "of" | "applying"> {
  /** Null only while no engine is listed (`removeEveryEngine`). */
  officeDefault: EngineModel | null = {
    engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    model: "claude-sonnet-5-5",
  };
  /** The effort every person works with unless `set` or a Stage gives another. */
  effort: Effort | null = "high";
  /** Each Role, location and Stage's effort the cascade was asked for, in order. */
  readonly asked: {
    readonly roleKey: string;
    readonly location: EngineCascadeLocation;
    readonly work: EngineCascadeWork;
  }[] = [];
  private readonly overrides = new Map<string, StandInWork>();
  private readonly tasks = new Map<string, EngineModel>();
  private readonly initiatives = new Map<string, EngineModel>();

  /** The Role `roleKey` runs on `work`, in the Project `projectId` or in every one. */
  set(roleKey: string, work: StandInWork, projectId?: string): void {
    this.overrides.set(keyOf(roleKey, projectId), work);
  }

  /** The Task `taskId` sets `engineModel`, or none again. */
  setForTask(taskId: string, engineModel: EngineModel | null): void {
    if (engineModel === null) this.tasks.delete(taskId);
    else this.tasks.set(taskId, engineModel);
  }

  /** The Initiative `initiativeId` sets `engineModel`, or none again. */
  setForInitiative(initiativeId: string, engineModel: EngineModel | null): void {
    if (engineModel === null) this.initiatives.delete(initiativeId);
    else this.initiatives.set(initiativeId, engineModel);
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
    return Promise.resolve(found && this.working(found.at, found.level, work));
  }

  private found(
    roleKey: string,
    { projectId, taskId, initiativeId }: EngineCascadeLocation,
  ): { readonly at: StandInWork; readonly level: EngineCascadeLevel } | null {
    const inProject =
      projectId === undefined ? undefined : this.overrides.get(keyOf(roleKey, projectId));
    if (inProject) return { at: inProject, level: "project-role-override" };
    const everywhere = this.overrides.get(keyOf(roleKey, undefined));
    if (everywhere) return { at: everywhere, level: "office-default" };
    const task = taskId === undefined ? undefined : this.tasks.get(taskId);
    if (task) return { at: task, level: "task-engine" };
    // A Task's id wins over an Initiative's, as the cascade's does.
    const initiative =
      taskId !== undefined || initiativeId === undefined
        ? undefined
        : this.initiatives.get(initiativeId);
    if (initiative) return { at: initiative, level: "initiative-engine" };
    return this.officeDefault && { at: this.officeDefault, level: "office-default" };
  }

  private working(
    { engineId, model, engineType = "claude-code", effort, gaveWay }: StandInWork,
    level: EngineCascadeLevel,
    { stageEffort }: EngineCascadeWork,
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
    };
  }
}

function keyOf(roleKey: string, projectId: string | undefined): string {
  return JSON.stringify([roleKey, projectId ?? null]);
}
