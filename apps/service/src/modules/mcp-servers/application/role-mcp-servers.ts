import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { McpServer } from "../domain/mcp-server.js";
import { McpServerRolesChanged } from "../domain/mcp-server-events.js";
import { sessionTools } from "../domain/session-mcp-servers.js";
import { McpServerNotFound } from "../domain/mcp-server-not-found.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { RoleMcpServerRepository } from "../ports/role-mcp-server-repository.js";

/**
 * A server on a Role's card: whether it is on, and the tools its sessions get, by name, each of
 * which has its setting in the card's permission profile; none while it is off.
 */
export interface McpServerOnCard {
  readonly name: string;
  readonly on: boolean;
  readonly tools: readonly string[];
}

function onCard(server: McpServer): McpServerOnCard {
  return {
    name: server.name,
    on: server.state === "on",
    tools: sessionTools(server).map(({ name }) => name),
  };
}

/**
 * Which servers each Role's Agents get (spec §5.4). A change reaches the Role's next sessions;
 * running ones keep the servers they started with.
 */
@Injectable()
export class RoleMcpServers {
  constructor(
    private readonly repository: RoleMcpServerRepository,
    private readonly servers: McpServerRepository,
    private readonly events: EventBus,
  ) {}

  /** The names of the Role's servers, in name order. */
  async of(roleKey: string): Promise<string[]> {
    return (await this.repository.list())
      .filter((assignment) => assignment.roleKey === roleKey)
      .map(({ serverName }) => serverName)
      .toSorted();
  }

  /** Each Role's servers as its card lists them, by the Role's key, each in name order. */
  async byRole(): Promise<ReadonlyMap<string, readonly McpServerOnCard[]>> {
    const library = new Map((await this.servers.list()).map((server) => [server.name, server]));
    const byRole = new Map<string, McpServerOnCard[]>();
    for (const { serverName, roleKey } of await this.repository.list()) {
      const server = library.get(serverName);
      if (server) byRole.set(roleKey, [...(byRole.get(roleKey) ?? []), onCard(server)]);
    }
    for (const servers of byRole.values())
      servers.sort((one, other) => one.name.localeCompare(other.name));
    return byRole;
  }

  /** The Role's servers as its card lists them, in name order. */
  async serversOf(roleKey: string): Promise<readonly McpServerOnCard[]> {
    return (await this.byRole()).get(roleKey) ?? [];
  }

  /** The Roles each server is assigned to, by the server's name, in key order. */
  async byServer(): Promise<ReadonlyMap<string, readonly string[]>> {
    const byServer = new Map<string, string[]>();
    for (const { serverName, roleKey } of await this.repository.list()) {
      byServer.set(serverName, [...(byServer.get(serverName) ?? []), roleKey]);
    }
    return byServer;
  }

  /** Assigns the server to exactly these Roles. */
  async assignServer(serverName: string, roleKeys: readonly string[]): Promise<string[]> {
    if (!(await this.servers.find(serverName))) throw new McpServerNotFound(serverName);
    const assigned = [...new Set(roleKeys.map((roleKey) => roleKey.trim()))]
      .filter((roleKey) => roleKey !== "")
      .toSorted();
    await this.repository.replaceRolesOf(serverName, assigned);
    await this.events.publish(new McpServerRolesChanged(serverName));
    return assigned;
  }
}
