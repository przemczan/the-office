import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { SizeThresholdChanged } from "../domain/conversation-events.js";
import {
  DEFAULT_CONTEXT_POLICY_SETTINGS,
  type ContextPolicySettings,
} from "../domain/context-policy.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";

/**
 * The Context policy's settings, read at each decision so a change applies to the next
 * continuation: the size threshold Settings › Office limits holds, the rest fixed.
 */
@Injectable()
export class ContextPolicySettingsService {
  constructor(
    private readonly settings: ConversationsSettings,
    private readonly events: EventBus,
  ) {}

  async current(): Promise<ContextPolicySettings> {
    return { ...DEFAULT_CONTEXT_POLICY_SETTINGS, sizeThreshold: await this.sizeThreshold() };
  }

  sizeThreshold(): Promise<number> {
    return this.settings.sizeThreshold();
  }

  async changeSizeThreshold(sizeThreshold: number): Promise<void> {
    await this.settings.changeSizeThreshold(sizeThreshold);
    await this.events.publish(new SizeThresholdChanged(sizeThreshold));
  }
}
