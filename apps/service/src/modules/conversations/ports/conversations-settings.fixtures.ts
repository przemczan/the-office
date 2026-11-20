import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../domain/context-policy.js";
import {
  DEFAULT_STAGE_CONTEXT_LIMITS,
  type StageContextLimits,
} from "../domain/stage-context-limits.js";
import { ConversationsSettings } from "./conversations-settings.js";

/**
 * Settings of the test's own: every test file shares the database, whose row each Context policy
 * decision would read.
 */
export class ConversationsSettingsForTests extends ConversationsSettings {
  private threshold = DEFAULT_CONTEXT_POLICY_SETTINGS.sizeThreshold;
  private limits: StageContextLimits = DEFAULT_STAGE_CONTEXT_LIMITS;

  async sizeThreshold(): Promise<number> {
    return this.threshold;
  }

  async changeSizeThreshold(sizeThreshold: number): Promise<void> {
    this.threshold = sizeThreshold;
  }

  async stageContextLimits(): Promise<StageContextLimits> {
    return this.limits;
  }

  async changeStageContextLimits(limits: StageContextLimits): Promise<void> {
    this.limits = limits;
  }
}
