import {
  McpServerFailure,
  type McpClient,
  type McpConnection,
} from "../../../../platform/mcp/mcp-client.js";
import type { SessionMcpServer } from "../../ports/session-options.js";

/** How long a server has to start and answer MCP's initialization. */
const CONNECT_TIMEOUT_MS = 30_000;

/** How long one tool call may run. */
const CALL_TIMEOUT_MS = 10 * 60_000;

/** What stands for a Server value in a failure's words. */
const SERVER_VALUE_MARK = "[a Server value]";

/** What a call of an MCP tool answered, as the Agent reads it. */
export interface McpToolAnswer {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * A session's connections to its MCP servers through The Office's own client, each opened by
 * `open` or at the first call of one of its tools, and kept until `close`, which ends a local
 * server's process tree.
 */
export class McpServerConnections {
  private readonly connections = new Map<string, Promise<McpConnection>>();
  private closed = false;

  constructor(
    private readonly servers: readonly SessionMcpServer[],
    private readonly client: McpClient,
  ) {}

  /**
   * Starts every server at once, before the session's first turn. One that fails is not an error:
   * its tools stay listed, as the session's tool list is fixed, and a call answers why.
   */
  async open(): Promise<void> {
    await Promise.allSettled(this.servers.map(async ({ name }) => this.connectionTo(name)));
  }

  /**
   * Calls a tool the Office rules allowed; a server that fails answers with why, as an error.
   * `signal` stops waiting for the answer, as when the turn is interrupted.
   */
  async call(
    server: string,
    tool: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<McpToolAnswer> {
    try {
      const connection = await this.connectionTo(server);
      const result = await connection.callTool(tool, inputObject(input), {
        timeoutMs: CALL_TIMEOUT_MS,
        signal,
      });
      return {
        // Images have no text for the Agent to read here, as the Claude Code engines report them.
        text: result.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n"),
        isError: result.isError,
      };
    } catch (error) {
      if (error instanceof McpServerFailure) {
        return { text: this.withoutServerValues(error.message), isError: true };
      }
      throw error;
    }
  }

  /** Ends every server the session started; a call after it is refused. */
  async close(): Promise<void> {
    this.closed = true;
    const opened = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      opened.map(async (connecting) => {
        const connection = await connecting.catch(() => undefined);
        await connection?.close();
      }),
    );
  }

  /**
   * A failure's words hold a local server's standard error, which may print a Server value, a
   * secret among them; the Agent and the kept conversation never read one there.
   */
  private withoutServerValues(text: string): string {
    return this.servers
      .flatMap(({ launch }) =>
        Object.values(launch.transport === "stdio" ? launch.environmentVariables : launch.headers),
      )
      .filter((value) => value !== "")
      .reduce((redacted, value) => redacted.replaceAll(value, SERVER_VALUE_MARK), text);
  }

  private connectionTo(name: string): Promise<McpConnection> {
    if (this.closed) throw new McpServerFailure(`The session has ended; ${name} is closed.`);
    const known = this.connections.get(name);
    if (known !== undefined) return known;
    const server = this.servers.find((candidate) => candidate.name === name);
    if (server === undefined) {
      throw new McpServerFailure(`${name} is not one of this session's MCP servers.`);
    }
    const connecting = this.client.connect(server.launch, { timeoutMs: CONNECT_TIMEOUT_MS });
    // A failed start is tried again at the next call, as the server may have been slow.
    connecting.catch(() => this.connections.delete(name));
    this.connections.set(name, connecting);
    return connecting;
  }
}

function inputObject(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Readonly<Record<string, unknown>>;
  }
  throw new McpServerFailure("An MCP tool takes its input as an object.");
}
