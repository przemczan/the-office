import type { EngineId } from "../../engine/index.js";

/** What a Task's Stage Threads have used on one engine id: input, output and cache writes. */
export interface EngineIdTokens {
  readonly engineId: EngineId;
  readonly tokens: number;
}

/** What each Task's sessions have used so far, which Conversations counts; the composition root binds it. */
export abstract class TaskTokens {
  /** The Task's Stage Threads' tokens by engine id, Planning left out; an engine id unused is left out. */
  abstract stageTokensSoFar(taskId: string): Promise<readonly EngineIdTokens[]>;
}
