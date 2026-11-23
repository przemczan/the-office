import type { EngineId, EngineModel } from "../../engine/index.js";

/** Where the cascade is weighed: in a Project, and on one of its Tasks. */
export interface EngineCascadePlace {
  readonly projectId: string;
  readonly taskId?: string;
}

/**
 * The Stand-in Engine list that applies where the cascade is weighed (spec §5.4.6), and whose it
 * is: the Project's own while it uses it, else the Office's.
 */
export interface StandInsApplying {
  readonly from: "office" | "project";
  readonly engineIds: readonly EngineId[];
}

/** The engine and model a Role runs on in a place, with the Stand-in Engine list that applies there. */
export interface EngineInCascade extends EngineModel {
  readonly standIns: StandInsApplying;
}

/** The engine cascade (spec §5.4), which the People module resolves; the composition root binds it. */
export abstract class KnownEngineCascade {
  /**
   * The engine and model the Role runs on in the Project, and on the Task when one is named (its
   * own engine, or its Initiative's, in the Project default's place), with the Stand-in Engine list
   * that applies there; none while no engine is listed; throws when nobody fills the Role.
   */
  abstract applying(roleKey: string, location: EngineCascadePlace): Promise<EngineInCascade | null>;
}
