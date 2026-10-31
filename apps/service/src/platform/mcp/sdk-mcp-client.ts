import { Injectable } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isOfficeOwnVariable } from "../config/office-config.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";
import type { OperatingSystem } from "../os/operating-system.js";
import type { Program } from "../os/program.js";
import {
  McpClient,
  McpServerFailure,
  type McpConnection,
  type McpRequestOptions,
  type McpServerLaunch,
  type McpTool,
  type McpToolContent,
  type McpToolResult,
} from "./mcp-client.js";
import { ProgramStdioTransport } from "./program-stdio-transport.js";

const CLIENT_INFO = { name: "the-office", version: "1.0.0" };

/** The MCP client on `@modelcontextprotocol/sdk`, a local server started through `startProgram`. */
@Injectable()
export class SdkMcpClient extends McpClient {
  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();

  async connect(launch: McpServerLaunch, options: McpRequestOptions): Promise<McpConnection> {
    const transport = this.transportOf(launch);
    const client = new Client(CLIENT_INFO);
    try {
      await client.connect(transport, requestOptionsOf(options));
    } catch (error) {
      await client.close().catch(() => undefined);
      throw failureOf(error, options, transport);
    }
    return new SdkMcpConnection(client, transport);
  }

  private transportOf(launch: McpServerLaunch): Transport {
    if (launch.transport === "streamable-http") {
      return new StreamableHTTPClientTransport(new URL(launch.url), {
        requestInit: { headers: { ...launch.headers } },
      });
    }
    const program: Program = {
      command: launch.command,
      arguments: launch.arguments,
      workingFolder: launch.workingFolder,
      environment: this.environmentOf(launch.environmentVariables),
    };
    return new ProgramStdioTransport(program, this.operatingSystem.processTrees);
  }

  /**
   * The service's environment without The Office's own variables, as a Project's commands get it,
   * with the server's variables over it; one named in another case on Windows replaces it.
   */
  private environmentOf(variables: Readonly<Record<string, string>>): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined && !isOfficeOwnVariable(name)) environment[name] = value;
    }
    for (const [name, value] of Object.entries(variables)) {
      for (const present of Object.keys(environment)) {
        if (this.operatingSystem.sameVariableName(present, name)) delete environment[present];
      }
      environment[name] = value;
    }
    return environment;
  }
}

class SdkMcpConnection implements McpConnection {
  constructor(
    private readonly client: Client,
    private readonly transport: Transport,
  ) {}

  async listTools(options: McpRequestOptions): Promise<readonly McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    try {
      do {
        const page = await this.client.listTools(
          cursor === undefined ? undefined : { cursor },
          requestOptionsOf(options),
        );
        tools.push(...page.tools.map(toMcpTool));
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    } catch (error) {
      throw failureOf(error, options, this.transport);
    }
    return tools;
  }

  async callTool(
    name: string,
    input: Readonly<Record<string, unknown>>,
    options: McpRequestOptions,
  ): Promise<McpToolResult> {
    try {
      const result = await this.client.callTool(
        { name, arguments: { ...input } },
        undefined,
        requestOptionsOf(options),
      );
      // A server on MCP's first version answers with `toolResult` instead of content.
      return "toolResult" in result
        ? { isError: false, content: [{ type: "text", text: JSON.stringify(result.toolResult) }] }
        : toMcpToolResult(result);
    } catch (error) {
      throw failureOf(error, options, this.transport);
    }
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

function requestOptionsOf({ timeoutMs, signal }: McpRequestOptions): RequestOptions {
  return { timeout: timeoutMs, ...(signal && { signal }) };
}

function toMcpTool({ name, description, inputSchema }: Tool): McpTool {
  return { name, description: description ?? "", inputSchema };
}

function toMcpToolResult({ isError, content }: CallToolResult): McpToolResult {
  return { isError: isError === true, content: content.map(toMcpToolContent) };
}

function toMcpToolContent(block: CallToolResult["content"][number]): McpToolContent {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") return { type: "image", data: block.data, mimeType: block.mimeType };
  return { type: "text", text: JSON.stringify(block) };
}

/** The failure in words, with the end of a local server's standard error, which says why. */
function failureOf(
  error: unknown,
  { timeoutMs }: McpRequestOptions,
  transport: Transport,
): McpServerFailure {
  const reason =
    error instanceof McpError && error.code === Number(ErrorCode.RequestTimeout)
      ? `The MCP server didn't answer within ${inSeconds(timeoutMs)}.`
      : `The MCP server failed: ${error instanceof Error ? error.message : String(error)}`;
  const output = transport instanceof ProgramStdioTransport ? transport.output : "";
  return new McpServerFailure(output === "" ? reason : `${reason}\n${output}`, { cause: error });
}

function inSeconds(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}
