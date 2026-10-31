import type { SessionMcpServerRecord } from "../domain/session-mcp-servers.js";

/** Where each session's servers are recorded while it can be resumed. */
export abstract class SessionMcpServerRepository {
  abstract add(record: SessionMcpServerRecord): Promise<void>;

  abstract find(sessionId: string): Promise<SessionMcpServerRecord | undefined>;

  /** Nothing happens when there is no record. */
  abstract remove(sessionId: string): Promise<void>;
}
