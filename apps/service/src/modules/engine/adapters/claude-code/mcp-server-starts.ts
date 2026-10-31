import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerNotStartedEvent } from "../../ports/session-events.js";

/**
 * The statuses the engine's init message gives a server that didn't start, with why when the
 * status says. A remote server answering 401 or 403 is `needs-auth`, which a session can't sign in
 * to, so it never starts either (binary 2.1.310).
 */
const NOT_STARTED: Readonly<Record<string, string | undefined>> = {
  failed: undefined,
  "needs-auth": "It asked for authentication; check its Server values.",
};

/**
 * The session's MCP servers the engine didn't start, each told once. The init message that opens
 * each turn lists every server with its status but never the error (binary 2.1.310), and lists
 * The Office's own tool server too, which is not one of the session's.
 */
export class McpServerStarts {
  private readonly told = new Set<string>();

  constructor(private readonly servers: readonly string[]) {}

  eventsOf(message: SDKMessage): McpServerNotStartedEvent[] {
    if (message.type !== "system" || message.subtype !== "init") return [];
    return message.mcp_servers.flatMap(({ name, status }) => {
      if (!(status in NOT_STARTED) || !this.servers.includes(name) || this.told.has(name)) {
        return [];
      }
      this.told.add(name);
      return [{ kind: "mcp-server-not-started", server: name, reason: NOT_STARTED[status] }];
    });
  }
}
