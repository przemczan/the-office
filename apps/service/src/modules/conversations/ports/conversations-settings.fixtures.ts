import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../domain/context-policy.js";
import { ConversationsSettings } from "./conversations-settings.js";

/**
 * Settings of the test's own: every test file shares the database, whose row each Context policy
 * decision would read.
 */
export class ConversationsSettingsForTests extends ConversationsSettings {
  private threshold = DEFAULT_CONTEXT_POLICY_SETTINGS.sizeThreshold;

  async sizeThreshold(): Promise<number> {
    return this.threshold;
  }

  async changeSizeThreshold(sizeThreshold: number): Promise<void> {
    this.threshold = sizeThreshold;
  }
}
