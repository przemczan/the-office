import { Injectable, Logger } from "@nestjs/common";
import type { McpServerLaunch } from "../../../platform/mcp/mcp-client.js";
import type { McpServer, McpServerTool } from "../domain/mcp-server.js";
import { serverValuesFor, type ProjectServerValue } from "../domain/project-server-values.js";
import {
  recordedMcpServer,
  resumeProblem,
  sessionTools,
  startProblem,
  type LeftOutMcpServer,
} from "../domain/session-mcp-servers.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { ProjectServerValueRepository } from "../ports/project-server-value-repository.js";
import { SessionMcpServerRepository } from "../ports/session-mcp-server-repository.js";
import { RoleMcpServers } from "./role-mcp-servers.js";
import { launchOf } from "./mcp-server-launch.js";

/** A server a session runs: how to reach it with its values, and the tools it was given. */
export interface PreparedMcpServer {
  readonly name: string;
  readonly launch: McpServerLaunch;
  readonly tools: readonly McpServerTool[];
}

/** What a session runs, and the Role's servers it doesn't, for the session to be told. */
export interface PreparedMcpServers {
  readonly servers: readonly PreparedMcpServer[];
  readonly leftOut: readonly LeftOutMcpServer[];
}

export interface SessionMcpServerRequest {
  readonly sessionId: string;
  /** The key of the Role the session works in: it gets the Role's servers that are on. */
  readonly roleKey: string;
  /** The Project whose values override the Office-wide ones; undefined in a chat. */
  readonly projectId: string | undefined;
  /** Where a local server starts, such as the Task's worktree. */
  readonly workingFolder: string;
}

/**
 * Gives each session its Role's MCP servers that are on, with its Project's Server values, and
 * records which, never their values, so a resume gets the same servers with the same tools.
 */
@Injectable()
export class SessionMcpServers {
  private readonly logger = new Logger(SessionMcpServers.name);

  constructor(
    private readonly servers: McpServerRepository,
    private readonly roleServers: RoleMcpServers,
    private readonly projectValues: ProjectServerValueRepository,
    private readonly records: SessionMcpServerRepository,
  ) {}

  /** For a new session: a server missing a required value is left out. */
  async prepare({
    sessionId,
    roleKey,
    projectId,
    workingFolder,
  }: SessionMcpServerRequest): Promise<PreparedMcpServers> {
    const names = new Set(await this.roleServers.of(roleKey));
    const assigned = (await this.servers.list())
      .filter((server) => names.has(server.name) && server.state === "on")
      .toSorted((one, other) => one.name.localeCompare(other.name));
    const values = await this.valuesOf(projectId);
    const prepared = this.launched(assigned, values, workingFolder);
    await this.records.add({
      sessionId,
      projectId,
      servers: assigned
        .filter((server) => prepared.servers.some(({ name }) => name === server.name))
        .map(recordedMcpServer),
      preparedAt: new Date(),
    });
    return prepared;
  }

  /**
   * For a resume: the servers the session recorded, with their values read afresh and the tools it
   * was given. One removed, turned off or changed since, or now missing a required value, is left
   * out. A session with no record, such as one older than MCP servers, gets none.
   */
  async rebuild(sessionId: string, workingFolder: string): Promise<PreparedMcpServers> {
    const record = await this.records.find(sessionId);
    if (!record) return { servers: [], leftOut: [] };
    const library = await this.servers.list();
    const kept: McpServer[] = [];
    const changed: LeftOutMcpServer[] = [];
    for (const recorded of record.servers) {
      const server = library.find(({ name }) => name === recorded.name);
      const problem = resumeProblem(recorded, server);
      if (problem !== undefined) changed.push({ name: recorded.name, reason: problem });
      else if (server) kept.push({ ...server, tools: recorded.tools });
    }
    const prepared = this.launched(kept, await this.valuesOf(record.projectId), workingFolder);
    const leftOut = [...changed, ...prepared.leftOut];
    for (const { name, reason } of leftOut) {
      this.logger.warn(`Session ${sessionId} resumes without MCP server "${name}": ${reason}`);
    }
    return { servers: prepared.servers, leftOut };
  }

  /** For a session that won't be resumed. */
  async forget(sessionId: string): Promise<void> {
    await this.records.remove(sessionId);
  }

  private async valuesOf(projectId: string | undefined): Promise<readonly ProjectServerValue[]> {
    return projectId === undefined ? [] : this.projectValues.ofProject(projectId);
  }

  private launched(
    servers: readonly McpServer[],
    projectValues: readonly ProjectServerValue[],
    workingFolder: string,
  ): PreparedMcpServers {
    const prepared: PreparedMcpServer[] = [];
    const leftOut: LeftOutMcpServer[] = [];
    for (const server of servers) {
      const values = serverValuesFor(server, projectValues);
      const problem = startProblem(server, values);
      if (problem !== undefined) leftOut.push({ name: server.name, reason: problem });
      else {
        prepared.push({
          name: server.name,
          launch: launchOf(server, values, workingFolder),
          tools: sessionTools(server),
        });
      }
    }
    return { servers: prepared, leftOut };
  }
}
