import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import {
  mcpServerNameTaken,
  type McpServer,
  type McpServerConnection,
} from "../../domain/mcp-server.js";
import type { McpServerChange } from "../../domain/mcp-server-changes.js";
import { McpServerNotFound } from "../../domain/mcp-server-not-found.js";
import { McpServerRefused } from "../../domain/mcp-server-refused.js";
import { McpServerRepository, type McpServerUpdate } from "../../ports/mcp-server-repository.js";
import { mcpServers } from "./mcp-servers.schema.js";

type McpServerRow = typeof mcpServers.$inferSelect;

@Injectable()
export class PostgresMcpServerRepository extends McpServerRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(server: McpServer): Promise<void> {
    const added = await this.database
      .insert(mcpServers)
      .values(toRow(server))
      .onConflictDoNothing()
      .returning({ name: mcpServers.name });
    if (added.length === 0) throw new McpServerRefused([mcpServerNameTaken(server.name)]);
  }

  async find(name: string): Promise<McpServer | undefined> {
    const [row] = await this.database.select().from(mcpServers).where(eq(mcpServers.name, name));
    return row && toMcpServer(row);
  }

  async list(): Promise<readonly McpServer[]> {
    const rows = await this.database
      .select()
      .from(mcpServers)
      .orderBy(asc(mcpServers.addedAt), asc(mcpServers.name));
    return rows.map(toMcpServer);
  }

  async update<Event extends DomainEvent>(
    name: string,
    change: (server: McpServer) => McpServerChange<Event> | undefined,
  ): Promise<McpServerUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.name, name))
        .for("update");
      if (!row) throw new McpServerNotFound(name);
      const server = toMcpServer(row);
      const changed = change(server);
      if (!changed) return { server, event: undefined };
      await transaction
        .update(mcpServers)
        .set(toRow(changed.server))
        .where(eq(mcpServers.name, name));
      return changed;
    });
  }

  async remove(name: string): Promise<McpServer> {
    const [row] = await this.database
      .delete(mcpServers)
      .where(eq(mcpServers.name, name))
      .returning();
    if (!row) throw new McpServerNotFound(name);
    return toMcpServer(row);
  }
}

function toRow({ name, connection, serverValues, state, tools, addedAt }: McpServer): McpServerRow {
  return {
    name,
    transport: connection.transport,
    command: connection.transport === "stdio" ? connection.command : null,
    arguments: connection.transport === "stdio" ? connection.arguments : null,
    url: connection.transport === "streamable-http" ? connection.url : null,
    serverValues,
    state,
    tools,
    addedAt,
  };
}

function toMcpServer(row: McpServerRow): McpServer {
  return {
    name: row.name,
    connection: connectionOf(row),
    serverValues: row.serverValues,
    state: row.state,
    tools: row.tools,
    addedAt: row.addedAt,
  };
}

/** The table's check keeps a stdio row's command and arguments set, and a remote row's URL. */
function connectionOf(row: McpServerRow): McpServerConnection {
  if (row.transport === "stdio") {
    return { transport: "stdio", command: row.command ?? "", arguments: row.arguments ?? [] };
  }
  return { transport: "streamable-http", url: row.url ?? "" };
}
