import type { EngineInCascade } from "../../people/index.js";

/** The Project and the Task a session is about. */
export interface TaskSessionPlace {
  readonly projectId: string;
  readonly taskId: string;
}

/**
 * The engine cascade (spec §5.4.5), which People resolves; the composition root binds it to
 * People's `EngineCascade`.
 */
export abstract class RoleEngineCascade {
  /**
   * The engine a session of the Role runs on about the Task, with the level that gave it, and the
   * model and effort its person works with there, each with its level; none while no engine is
   * listed. For a Role someone fills.
   */
  abstract applying(roleKey: string, place: TaskSessionPlace): Promise<EngineInCascade | null>;
}
