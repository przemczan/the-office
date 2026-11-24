import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { EngineWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  EngineAccountChanged,
  EngineModelsListed,
  WindowStartRecorded,
} from "../../domain/engine-events.js";

/**
 * A Sign in's end reaches the web, so Settings › Engines refetches that engine's account; and a
 * change of an engine's Window start, so it refetches the settings; and an engine's models listed,
 * so the model choices shown are read again.
 */
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
    this.forwarding.forward(
      EngineModelsListed,
      ({ engineId }): Omit<EngineWebEvent, "occurredAt"> => ({
        type: "engine.models-listed",
        engineId,
      }),
    );
    this.forwarding.forward(
      WindowStartRecorded,
      ({ engineId }): Omit<EngineWebEvent, "occurredAt"> => ({
        type: "engine.window-start-changed",
        engineId,
      }),
    );
  }
}
