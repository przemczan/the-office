import { FIRST_CLAUDE_CODE_ENGINE, type EngineModel } from "../engine/index.js";
import type { EngineCascade } from "./application/engine-cascade.js";
import type { EngineInCascade } from "./domain/engine-cascade.js";

/**
 * The engine cascade as a test sets it, for tests that stand in for People: every Role runs on
 * `officeDefault` unless `set` gave it, or it in one Project, an engine and model of its own.
 */
export class EngineCascadeStandIn implements Pick<EngineCascade, "of"> {
  officeDefault: EngineModel = {
    engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    model: "claude-sonnet-5-5",
  };
  private readonly overrides = new Map<string, EngineModel>();

  /** The Role `roleKey` runs on `engineModel`, in the Project `projectId` or in every one. */
  set(roleKey: string, engineModel: EngineModel, projectId?: string): void {
    this.overrides.set(keyOf(roleKey, projectId), engineModel);
  }

  of(roleKey: string, projectId?: string): Promise<EngineInCascade> {
    const inProject =
      projectId === undefined ? undefined : this.overrides.get(keyOf(roleKey, projectId));
    if (inProject) return Promise.resolve({ ...inProject, level: "project-role-override" });
    const override = this.overrides.get(keyOf(roleKey, undefined));
    if (override) return Promise.resolve({ ...override, level: "role-override" });
    return Promise.resolve({ ...this.officeDefault, level: "office-default" });
  }
}

function keyOf(roleKey: string, projectId: string | undefined): string {
  return JSON.stringify([roleKey, projectId ?? null]);
}
