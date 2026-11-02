import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { EngineWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { EngineAccountChanged } from "../../domain/engine-events.js";

/** A Sign in's end reaches the web, so Settings › Engines refetches that engine's account. */
@Injectable()
export class EngineWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      EngineAccountChanged,
      ({ engineId }): Omit<EngineWebEvent, "occurredAt"> => ({
        type: "engine.account-changed",
        engineId,
      }),
    );
  }
}
