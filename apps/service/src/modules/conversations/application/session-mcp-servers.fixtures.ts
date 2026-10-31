import type { PreparedMcpServers, SessionMcpServers } from "../../mcp-servers/index.js";

/** What the stand-in was asked, and what it answers. */
export interface SessionMcpServersStandIn {
  readonly service: Pick<SessionMcpServers, "prepare" | "rebuild" | "forget">;
  readonly prepared: Parameters<SessionMcpServers["prepare"]>[0][];
  readonly rebuilt: string[];
  readonly forgotten: string[];
}

const NONE: PreparedMcpServers = { servers: [], leftOut: [] };

/**
 * Stands in for the MCP servers module, which the library shared by every test file would
 * otherwise give: each new session gets `onStart`, each resumed one `onResume`.
 */
export function sessionMcpServersStandIn(
  onStart: PreparedMcpServers = NONE,
  onResume: PreparedMcpServers = NONE,
): SessionMcpServersStandIn {
  const prepared: SessionMcpServersStandIn["prepared"] = [];
  const rebuilt: string[] = [];
  const forgotten: string[] = [];
  return {
    service: {
      prepare: (request) => {
        prepared.push(request);
        return Promise.resolve(onStart);
      },
      rebuild: (sessionId) => {
        rebuilt.push(sessionId);
        return Promise.resolve(onResume);
      },
      forget: (sessionId) => {
        forgotten.push(sessionId);
        return Promise.resolve();
      },
    },
    prepared,
    rebuilt,
    forgotten,
  };
}
