import type { EngineModel } from "../../engine/index.js";

/** Where the cascade is weighed: in a Project, and on one of its Tasks. */
export interface EngineCascadePlace {
  readonly projectId: string;
  readonly taskId?: string;
}

/** The engine cascade (spec §5.4), which the People module resolves; the composition root binds it. */
export abstract class KnownEngineCascade {
  /**
   * The engine and model the Role runs on in the Project, and on the Task when one is named (its
   * own engine, or its Initiative's, in the Project default's place), none while no engine is
   * listed; throws when nobody fills the Role.
   */
  abstract applying(roleKey: string, location: EngineCascadePlace): Promise<EngineModel | null>;
}
