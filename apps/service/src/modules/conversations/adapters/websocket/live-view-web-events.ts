import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { LiveViewWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { LiveViewChanged } from "../../domain/conversation-events.js";
import { toLiveViewResponse } from "../http/live-view-responses.js";

/** The Live view reaches the web whole on each change, scoped to no Thread: no page refetches it. */
@Injectable()
export class LiveViewWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(LiveViewChanged, (event): Omit<LiveViewWebEvent, "occurredAt"> => ({
      type: "live-view.changed",
      liveView: toLiveViewResponse(event.liveView),
    }));
  }
}
