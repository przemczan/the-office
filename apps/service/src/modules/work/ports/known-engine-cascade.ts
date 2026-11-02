import type { EngineModel } from "../../engine/index.js";

/** The engine cascade (spec §5.4), which the People module resolves; the composition root binds it. */
export abstract class KnownEngineCascade {
  /**
   * The engine and model the Role runs on in the Project, none while no engine is listed; throws
   * when nobody fills the Role.
   */
  abstract applying(roleKey: string, projectId: string): Promise<EngineModel | null>;
}
