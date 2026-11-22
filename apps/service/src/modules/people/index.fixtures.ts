import { FIRST_CLAUDE_CODE_ENGINE, NoEngineListed, type EngineModel } from "../engine/index.js";
import type { EngineCascade, EngineCascadeLocation } from "./application/engine-cascade.js";
import type { EngineInCascade } from "./domain/engine-cascade.js";
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

/**
 * The engine cascade as a test sets it, for tests that stand in for People: every Role runs on
 * `officeDefault` unless `set` gave it, or it in one Project, an engine and model of its own, or
 * `setForTask` or `setForInitiative` gave the Task or the Initiative a session is about one. Levels
 * win as the cascade's do: the Project's Role override, the Role override, the Task's engine, the
 * Initiative's, the Office default (it has no Project default). Every location asked is kept in
 * `asked`, for a test to check where a session resolved the cascade.
 */
export class EngineCascadeStandIn implements Pick<EngineCascade, "of" | "applying"> {
  /** Null only while no engine is listed (`removeEveryEngine`). */
  officeDefault: EngineModel | null = {
    engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    model: "claude-sonnet-5-5",
  };
  /** Each Role and location the cascade was asked for, in order. */
  readonly asked: { readonly roleKey: string; readonly location: EngineCascadeLocation }[] = [];
  private readonly overrides = new Map<string, EngineModel>();
  private readonly tasks = new Map<string, EngineModel>();
  private readonly initiatives = new Map<string, EngineModel>();

  /** The Role `roleKey` runs on `engineModel`, in the Project `projectId` or in every one. */
  set(roleKey: string, engineModel: EngineModel, projectId?: string): void {
    this.overrides.set(keyOf(roleKey, projectId), engineModel);
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

  async of(roleKey: string, location: EngineCascadeLocation = {}): Promise<EngineInCascade> {
    const applying = await this.applying(roleKey, location);
    if (applying === null) throw new NoEngineListed();
    return applying;
  }

  applying(roleKey: string, location: EngineCascadeLocation = {}): Promise<EngineInCascade | null> {
    this.asked.push({ roleKey, location });
    const { projectId, taskId, initiativeId } = location;
    const inProject =
      projectId === undefined ? undefined : this.overrides.get(keyOf(roleKey, projectId));
    if (inProject) return Promise.resolve({ ...inProject, level: "project-role-override" });
    const override = this.overrides.get(keyOf(roleKey, undefined));
    if (override) return Promise.resolve({ ...override, level: "role-override" });
    const task = taskId === undefined ? undefined : this.tasks.get(taskId);
    if (task) return Promise.resolve({ ...task, level: "task-engine" });
    // A Task's id wins over an Initiative's, as the cascade's does.
    const initiative =
      taskId !== undefined || initiativeId === undefined
        ? undefined
        : this.initiatives.get(initiativeId);
    if (initiative) return Promise.resolve({ ...initiative, level: "initiative-engine" });
    const { officeDefault } = this;
    return Promise.resolve(officeDefault && { ...officeDefault, level: "office-default" });
  }
}

function keyOf(roleKey: string, projectId: string | undefined): string {
  return JSON.stringify([roleKey, projectId ?? null]);
}
