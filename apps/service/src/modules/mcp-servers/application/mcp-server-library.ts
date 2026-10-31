import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  mcpServerNameTaken,
  type McpServer,
  type McpServerEdit,
  type NewMcpServer,
} from "../domain/mcp-server.js";
import { addMcpServer, changeMcpServer, removeMcpServer } from "../domain/mcp-server-changes.js";
import { McpServerNotFound } from "../domain/mcp-server-not-found.js";
import { McpServerRefused } from "../domain/mcp-server-refused.js";
import { pastedMcpServer } from "../domain/pasted-config.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";

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
    const { server, event } = await this.repository.update(name, (kept) =>
      changeMcpServer(kept, edit),
    );
    if (event) await this.events.publish(event);
    return server;
  }

  async remove(name: string): Promise<void> {
    const server = await this.repository.remove(name);
    await this.events.publish(removeMcpServer(server));
  }
}
