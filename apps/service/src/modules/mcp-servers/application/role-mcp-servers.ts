import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { McpServerRolesChanged } from "../domain/mcp-server-events.js";
import { McpServerNotFound } from "../domain/mcp-server-not-found.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { RoleMcpServerRepository } from "../ports/role-mcp-server-repository.js";

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
