import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ActivityWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ActivityChanged } from "../../domain/activity-events.js";

/** Each change reaches the web as `activity.changed`, with nothing: each browser reads its own. */
@Injectable()
export class ActivityWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(ActivityChanged, (): Omit<ActivityWebEvent, "occurredAt"> => ({
      type: "activity.changed",
    }));
  }
}
