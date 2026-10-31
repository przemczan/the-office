import { tmpdir } from "node:os";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { McpClient, McpServerFailure } from "../../../platform/mcp/mcp-client.js";
import {
  mcpServerNameTaken,
  withoutSecrets,
  type McpServer,
  type McpServerEdit,
  type McpServerTool,
  type NewMcpServer,
} from "../domain/mcp-server.js";
import {
  addMcpServer,
  changeMcpServer,
  removeMcpServer,
  turnOffMcpServer,
  turnOnMcpServer,
  type McpServerChange,
} from "../domain/mcp-server-changes.js";
import { McpServerNotFound } from "../domain/mcp-server-not-found.js";
import { McpServerRefused } from "../domain/mcp-server-refused.js";
import { reviewDigest } from "../domain/mcp-server-review.js";
import { pastedMcpServer } from "../domain/pasted-config.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { launchOf, officeWideValues } from "./mcp-server-launch.js";

/** How long a review waits for the server to start and list its tools: `npx` may download it first. */
const REVIEW_TIMEOUT_MS = 60_000;

/** What a review shows: the server with its tools on a test connection, or why it couldn't connect. */
export type McpServerReview =
  | {
      readonly server: McpServer;
      readonly connected: true;
      readonly tools: readonly McpServerTool[];
      /** What turning it on is checked against: see `reviewDigest`. */
      readonly reviewDigest: string;
    }
  | { readonly server: McpServer; readonly connected: false; readonly problem: string };

/**
 * The MCP server library's use cases (spec §5.4). A server arrives off, waiting for review. Each
 * change is saved first and its event published after, so nothing hears of a change that wasn't
 * kept.
 */
@Injectable()
export class McpServerLibrary {
  constructor(
    private readonly repository: McpServerRepository,
    private readonly events: EventBus,
    private readonly client: McpClient,
  ) {}

  async list(): Promise<readonly McpServer[]> {
    return this.repository.list();
  }

  async read(name: string): Promise<McpServer> {
    const server = await this.repository.find(name);
    if (!server) throw new McpServerNotFound(name);
    return server;
  }

  /** Refuses with every reason, before keeping anything, when it breaks a rule. */
  async add(newServer: NewMcpServer): Promise<McpServer> {
    const { server, event } = addMcpServer(newServer, new Date());
    if (await this.repository.find(server.name)) {
      throw new McpServerRefused([mcpServerNameTaken(server.name)]);
    }
    await this.repository.add(server);
    await this.events.publish(event);
    return server;
  }

  /** The server a pasted JSON config describes, for the form to show; nothing is kept. */
  readPastedConfig(config: string): NewMcpServer {
    return pastedMcpServer(config);
  }

  async change(name: string, edit: McpServerEdit): Promise<McpServer> {
    return this.update(name, (kept) => changeMcpServer(kept, edit));
  }

  async remove(name: string): Promise<void> {
    const server = await this.repository.remove(name);
    await this.events.publish(removeMcpServer(server));
  }

  /**
   * Connects with the Office-wide values and lists the tools, for the user to review before
   * turning it on. A server that can't be reached is no error: the review says why, a secret's
   * value hidden from the server's own words.
   */
  async review(name: string): Promise<McpServerReview> {
    const server = await this.read(name);
    try {
      const tools = await this.listedTools(server);
      return { server, connected: true, tools, reviewDigest: reviewDigest(server, tools) };
    } catch (error) {
      if (!(error instanceof McpServerFailure)) throw error;
      return { server, connected: false, problem: withoutSecrets(error.message, server) };
    }
  }

  /**
   * Turns it on, recording its tools as listed again, only when they and the server as kept are
   * what the review the user saw showed (`reviewDigest`).
   */
  async turnOn(name: string, reviewed: string): Promise<McpServer> {
    const server = await this.read(name);
    let tools: readonly McpServerTool[];
    try {
      tools = await this.listedTools(server);
    } catch (error) {
      if (!(error instanceof McpServerFailure)) throw error;
      throw new McpServerRefused([withoutSecrets(error.message, server)]);
    }
    return this.update(name, (kept) => turnOnMcpServer(kept, tools, reviewed));
  }

  async turnOff(name: string): Promise<McpServer> {
    return this.update(name, turnOffMcpServer);
  }

  private async update<Event extends DomainEvent>(
    name: string,
    change: (server: McpServer) => McpServerChange<Event> | undefined,
  ): Promise<McpServer> {
    const { server, event } = await this.repository.update(name, change);
    if (event) await this.events.publish(event);
    return server;
  }

  private async listedTools(server: McpServer): Promise<readonly McpServerTool[]> {
    const launch = launchOf(server, officeWideValues(server), tmpdir());
    const connection = await this.client.connect(launch, { timeoutMs: REVIEW_TIMEOUT_MS });
    try {
      return await connection.listTools({ timeoutMs: REVIEW_TIMEOUT_MS });
    } finally {
      await connection.close();
    }
  }
}
