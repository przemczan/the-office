import type { PreparedMcpServers, SessionMcpServers } from "../../mcp-servers/index.js";

/** What the stand-in was asked, and what it answers. */
export interface SessionMcpServersStandIn {
  readonly service: Pick<SessionMcpServers, "prepare" | "rebuild" | "forget">;
  readonly prepared: Parameters<SessionMcpServers["prepare"]>[0][];
  readonly rebuilt: string[];
  readonly forgotten: string[];
  /** Holds the next new session's servers until released, as a slow server would. */
  holdNextPrepare(): HeldPreparation;
}

/** A new session's MCP servers held while they are prepared. */
export interface HeldPreparation {
  /** Resolves once a session's opening is waiting for them. */
  readonly reached: Promise<void>;
  /** Lets them go: the opening goes on. */
  release(): void;
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
  const holds: { readonly reach: () => void; readonly released: Promise<void> }[] = [];
  return {
    service: {
      prepare: async (request) => {
        prepared.push(request);
        const hold = holds.shift();
        if (hold) {
          hold.reach();
          await hold.released;
        }
        return onStart;
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
    holdNextPrepare: () => {
      let reach!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => (reach = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      holds.push({ reach, released });
      return { reached, release };
    },
  };
}
