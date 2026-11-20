import type { StageContextLimits } from "../domain/stage-context-limits.js";

/** The Office settings the Context policy reads; Settings edits them. */
export abstract class ConversationsSettings {
  /** In tokens; the default until Settings saves one. */
  abstract sizeThreshold(): Promise<number>;

  abstract changeSizeThreshold(sizeThreshold: number): Promise<void>;

  /** The Office defaults of every Agent Stage's context limits; the defaults until Settings saves. */
  abstract stageContextLimits(): Promise<StageContextLimits>;

  abstract changeStageContextLimits(limits: StageContextLimits): Promise<void>;
}
