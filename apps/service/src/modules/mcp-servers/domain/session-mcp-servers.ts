import type { McpServer, McpServerTool } from "./mcp-server.js";
import { reviewDigest } from "./mcp-server-review.js";
import { missingRequiredValues } from "./project-server-values.js";

/**
 * A server a session started with, as recorded for its resumes: never its values, which may hold
 * secrets and are read afresh each time.
 */
export interface RecordedMcpServer {
  readonly name: string;
  /** The tools the session was given, which stay its tools on every resume. */
  readonly tools: readonly McpServerTool[];
  /** The server as it was reviewed when the session started: see `reviewDigest`. */
  readonly reviewDigest: string;
}

/** What a session started with, kept while it can be resumed. */
export interface SessionMcpServerRecord {
  readonly sessionId: string;
  /** The Project whose values the session's servers get; undefined for the Office-wide values. */
  readonly projectId: string | undefined;
  readonly servers: readonly RecordedMcpServer[];
  readonly preparedAt: Date;
}

/** One of the Role's servers that a session doesn't get, with why, in the brief's words. */
export interface LeftOutMcpServer {
  readonly name: string;
  readonly reason: string;
}

/** Why a server that is on can't run in the session with these values, or undefined when it can. */
export function startProblem(
  server: McpServer,
  values: Readonly<Record<string, string>>,
): string | undefined {
  const missing = missingRequiredValues(server, values);
  if (missing.length === 0) return undefined;
  return `it has no value for ${missing.join(", ")}.`;
}

/** What a session records of a server it starts with. */
export function recordedMcpServer(server: McpServer): RecordedMcpServer {
  return {
    name: server.name,
    tools: server.tools,
    reviewDigest: reviewDigest(server, server.tools),
  };
}

/**
 * Why a server the session started with can't come back on its resume: it was removed, turned off,
 * or changed since (a new review, other tools), so the session's tools would no longer be what it
 * was given. Undefined when it is as the session recorded it.
 */
export function resumeProblem(
  recorded: RecordedMcpServer,
  server: McpServer | undefined,
): string | undefined {
  if (!server) return "it is no longer in the MCP server library.";
  if (server.state !== "on") return "it was turned off.";
  if (reviewDigest(server, server.tools) !== recorded.reviewDigest) {
    return "it changed since the session started.";
  }
  return undefined;
}
