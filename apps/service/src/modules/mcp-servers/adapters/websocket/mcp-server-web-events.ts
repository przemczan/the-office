import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { McpServerWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  McpServerAdded,
  McpServerChanged,
  McpServerRemoved,
  McpServerTurnedOff,
  McpServerTurnedOn,
} from "../../domain/mcp-server-events.js";

type WebEventOf<Type extends McpServerWebEvent["type"]> = Omit<
  Extract<McpServerWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every library event reaches the web, naming the server, so an open page refetches it. */
@Injectable()
export class McpServerWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(McpServerAdded, (event): WebEventOf<"mcp-server.added"> => ({
      type: "mcp-server.added",
      serverName: event.serverName,
    }));
    this.forwarding.forward(McpServerChanged, (event): WebEventOf<"mcp-server.changed"> => ({
      type: "mcp-server.changed",
      serverName: event.serverName,
    }));
    this.forwarding.forward(McpServerTurnedOn, (event): WebEventOf<"mcp-server.turned-on"> => ({
      type: "mcp-server.turned-on",
      serverName: event.serverName,
    }));
    this.forwarding.forward(McpServerTurnedOff, (event): WebEventOf<"mcp-server.turned-off"> => ({
      type: "mcp-server.turned-off",
      serverName: event.serverName,
    }));
    this.forwarding.forward(McpServerRemoved, (event): WebEventOf<"mcp-server.removed"> => ({
      type: "mcp-server.removed",
      serverName: event.serverName,
    }));
  }
}
