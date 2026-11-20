import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Json } from "../json.ts";
import type { ToolServer } from "./office-channel.ts";
import { geminiEnvironment } from "./session-environment.ts";

/** A Project's stdio MCP server for a session: its values go to its own process only. */
export interface ProjectMcpServer {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A Project's MCP server run by the check, as the adapter's `McpServerConnections` runs a Role's in
 * the service: started over stdio with its values in its own environment, and served to the CLI's
 * relay through the channel, so no value reaches the CLI.
 */
export class ProjectMcpConnection implements ToolServer {
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async open(server: ProjectMcpServer): Promise<ProjectMcpConnection> {
    const client = new Client({ name: "office-engine-check", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: server.command,
        args: [...server.args],
        env: { ...geminiEnvironment(), ...server.env },
        stderr: "ignore",
      }),
    );
    return new ProjectMcpConnection(client);
  }

  async listTools(): Promise<Tool[]> {
    return (await this.client.listTools()).tools;
  }

  async callTool(name: string, input: Json): Promise<CallToolResult> {
    const args =
      input !== null && typeof input === "object" && !Array.isArray(input) ? input : undefined;
    return (await this.client.callTool({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    })) as CallToolResult;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
