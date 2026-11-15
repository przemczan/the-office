import { FIRST_CLAUDE_CODE_ENGINE, NoEngineListed, type EngineModel } from "../engine/index.js";
import type { EngineCascade } from "./application/engine-cascade.js";
import type { EngineInCascade } from "./domain/engine-cascade.js";
import { consult, type HardSwitchValue } from "./domain/hard-switches.js";
import { DEVOPS } from "./domain/known-roles.js";

export { DutyRepository } from "./ports/duty-repository.js";
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
 * `officeDefault` unless `set` gave it, or it in one Project, an engine and model of its own.
 */
export class EngineCascadeStandIn implements Pick<EngineCascade, "of" | "applying"> {
  /** Null only while no engine is listed (`removeEveryEngine`). */
  officeDefault: EngineModel | null = {
    engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    model: "claude-sonnet-5-5",
  };
  private readonly overrides = new Map<string, EngineModel>();

  /** The Role `roleKey` runs on `engineModel`, in the Project `projectId` or in every one. */
  set(roleKey: string, engineModel: EngineModel, projectId?: string): void {
    this.overrides.set(keyOf(roleKey, projectId), engineModel);
  }

  /** As removing the only engine leaves it: every level moved to none. */
  removeEveryEngine(): void {
    this.officeDefault = null;
    this.overrides.clear();
  }

  async of(roleKey: string, projectId?: string): Promise<EngineInCascade> {
    const applying = await this.applying(roleKey, projectId);
    if (applying === null) throw new NoEngineListed();
    return applying;
  }

  applying(roleKey: string, projectId?: string): Promise<EngineInCascade | null> {
    const inProject =
      projectId === undefined ? undefined : this.overrides.get(keyOf(roleKey, projectId));
    if (inProject) return Promise.resolve({ ...inProject, level: "project-role-override" });
    const override = this.overrides.get(keyOf(roleKey, undefined));
    if (override) return Promise.resolve({ ...override, level: "role-override" });
    const { officeDefault } = this;
    return Promise.resolve(officeDefault && { ...officeDefault, level: "office-default" });
  }
}

function keyOf(roleKey: string, projectId: string | undefined): string {
  return JSON.stringify([roleKey, projectId ?? null]);
}
