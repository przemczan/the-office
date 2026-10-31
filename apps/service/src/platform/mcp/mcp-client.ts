/**
 * How to reach an MCP server: a local command started for the connection (stdio), with its
 * environment variables, or a remote URL (Streamable HTTP), with its headers.
 */
export type McpServerLaunch =
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly arguments: readonly string[];
      /** Set over the service's environment without The Office's own variables. */
      readonly environmentVariables: Readonly<Record<string, string>>;
      readonly workingFolder: string;
    }
  | {
      readonly transport: "streamable-http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

/** A tool as the server lists it. */
export interface McpTool {
  readonly name: string;
  /** Empty when the server gives none. */
  readonly description: string;
  /** The JSON Schema of its input. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** What a tool answered; a block other than text or an image comes as its JSON text. */
export type McpToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface McpToolResult {
  /** The tool ran and failed: its content says why, for the model to read. */
  readonly isError: boolean;
  readonly content: readonly McpToolContent[];
}

export interface McpRequestOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

/** One connection to a server, open until `close`. */
export interface McpConnection {
  /** Every tool, across the server's pages. */
  listTools(options: McpRequestOptions): Promise<readonly McpTool[]>;
  callTool(
    name: string,
    input: Readonly<Record<string, unknown>>,
    options: McpRequestOptions,
  ): Promise<McpToolResult>;
  /** Ends the connection; a local server's process ends with every process it started. */
  close(): Promise<void>;
}

/**
 * The Office's MCP client: the review of a server and the engines' sessions connect through it.
 * Throws McpServerFailure when the server can't be reached or doesn't answer in time.
 */
export abstract class McpClient {
  /** Connected once the server has answered MCP's initialization; nothing is left running if not. */
  abstract connect(launch: McpServerLaunch, options: McpRequestOptions): Promise<McpConnection>;
}

/** The server couldn't be reached, failed or didn't answer in time; the message says how. */
export class McpServerFailure extends Error {
  override readonly name = "McpServerFailure";
}
