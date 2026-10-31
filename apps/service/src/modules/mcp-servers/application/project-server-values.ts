import { Injectable } from "@nestjs/common";
import type { McpServer, ServerValue } from "../domain/mcp-server.js";
import { McpServerRefused } from "../domain/mcp-server-refused.js";
import {
  editedProjectServerValues,
  keptValue,
  type ProjectServerValue,
  type ProjectServerValueEdit,
} from "../domain/project-server-values.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { ProjectServerValueRepository } from "../ports/project-server-value-repository.js";

/** A Server value as a Project's page shows it: the declared value with the Project's own. */
export interface ProjectServerValueView {
  readonly serverValue: ServerValue;
  /** Undefined when the Project doesn't set it, so the Office-wide value applies. */
  readonly projectValue: string | undefined;
}

/** One server's Server values on a Project's page. */
export interface ProjectMcpServerValues {
  readonly serverName: string;
  readonly serverValues: readonly ProjectServerValueView[];
}

/**
 * A Project's own Server values (spec §5.4), over the Office-wide ones, for its sessions. The
 * caller checks that the Project exists; the values are forgotten with their server.
 */
@Injectable()
export class ProjectServerValues {
  constructor(
    private readonly servers: McpServerRepository,
    private readonly repository: ProjectServerValueRepository,
  ) {}

  /** Each server of the library that has Server values, in the library's order. */
  async of(projectId: string): Promise<readonly ProjectMcpServerValues[]> {
    const projectValues = await this.repository.ofProject(projectId);
    return (await this.servers.list())
      .filter((server) => server.serverValues.length > 0)
      .map((server) => viewOf(server, projectValues));
  }

  /**
   * Saves the Project's values for the server; refuses with every reason for a server the library
   * lacks or a name that isn't one of its Server values.
   */
  async change(
    projectId: string,
    serverName: string,
    edits: readonly ProjectServerValueEdit[],
  ): Promise<ProjectMcpServerValues> {
    const server = await this.servers.find(serverName);
    if (!server) throw new McpServerRefused([`There is no MCP server "${serverName}".`]);
    const kept = await this.repository.ofProject(projectId);
    const values = editedProjectServerValues(server, projectId, kept, edits);
    await this.repository.replace(projectId, serverName, values);
    return viewOf(server, values);
  }
}

function viewOf(
  server: McpServer,
  projectValues: readonly ProjectServerValue[],
): ProjectMcpServerValues {
  return {
    serverName: server.name,
    serverValues: server.serverValues.map((serverValue) => ({
      serverValue,
      projectValue: keptValue(projectValues, server.name, serverValue),
    })),
  };
}
