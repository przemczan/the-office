import { queryOptions } from "@tanstack/react-query";
import {
  mcpServerListSchema,
  mcpServerReviewSchema,
  mcpServerSchema,
  mcpServerWebEventSchema,
  newMcpServerSchema,
  type McpServer,
  type McpServerEdit,
  type McpServerStateChange,
  type McpServerWebEvent,
  type NewMcpServer,
  type WebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const MCP_SERVERS = ["mcp-servers"] as const;
const ROLES = ["roles"] as const;
const PROJECTS = ["projects"] as const;

/** Kept apart from the library's key, so a library event doesn't connect to every open review. */
function reviewKey(name: string) {
  return ["mcp-server-review", name] as const;
}

export const mcpServerQueries = {
  list: () =>
    queryOptions({
      queryKey: MCP_SERVERS,
      queryFn: ({ signal }) => getFromApi("/mcp-servers", mcpServerListSchema, signal),
    }),
  /**
   * A test connection with the Office-wide values: each read starts a local server or calls a
   * remote one, so it is read once per open review and when the server changes, never on focus.
   */
  review: (name: string) =>
    queryOptions({
      queryKey: reviewKey(name),
      queryFn: ({ signal }) =>
        getFromApi(`${mcpServerPath(name)}/review`, mcpServerReviewSchema, signal),
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    }),
};

/** Adds it off, until the user reviews it. */
export function addMcpServer(server: NewMcpServer): Promise<McpServer> {
  return sendToApi("POST", "/mcp-servers", server, mcpServerSchema);
}

/** One server in the shape of Claude Code's `mcpServers`, read for the form; nothing is kept. */
export function readPastedConfig(config: string): Promise<NewMcpServer> {
  return sendToApi("POST", "/mcp-servers/pasted-config", { config }, newMcpServerSchema);
}

/** Its command or URL and its Server values; a change to what runs turns it off. */
export function changeMcpServer(name: string, edit: McpServerEdit): Promise<McpServer> {
  return sendToApi("PUT", mcpServerPath(name), edit, mcpServerSchema);
}

/** Turning it on carries the digest of the review the user read. */
export function changeMcpServerState(
  name: string,
  change: McpServerStateChange,
): Promise<McpServer> {
  return sendToApi("PUT", `${mcpServerPath(name)}/state`, change, mcpServerSchema);
}

/** Assigns the server to exactly these Roles, by key. */
export function assignMcpServer(name: string, roles: readonly string[]): Promise<McpServer> {
  return sendToApi("PUT", `${mcpServerPath(name)}/roles`, { roles: [...roles] }, mcpServerSchema);
}

export function removeMcpServer(name: string): Promise<void> {
  return deleteFromApi(mcpServerPath(name));
}

/**
 * Every library event makes the library stale. A Role carries its servers and their tools, and a
 * Project's page lists the library's Server values, so they follow; a review is read again only
 * when what it connects to changed.
 */
export const mcpServerEventInvalidations: Readonly<
  Record<McpServerWebEvent["type"], EventInvalidations[string]>
> = {
  "mcp-server.added": () => [MCP_SERVERS, PROJECTS],
  "mcp-server.changed": (event) => [MCP_SERVERS, ROLES, PROJECTS, reviewKey(serverNameOf(event))],
  "mcp-server.turned-on": () => [MCP_SERVERS, ROLES],
  "mcp-server.turned-off": () => [MCP_SERVERS, ROLES],
  "mcp-server.roles-changed": () => [MCP_SERVERS, ROLES],
  "mcp-server.removed": () => [MCP_SERVERS, ROLES, PROJECTS],
};

/** The event stream checks only the fields every web event has; the server's name is the library's. */
function serverNameOf(event: WebEvent): string {
  const parsed = mcpServerWebEventSchema.safeParse(event);
  return parsed.success ? parsed.data.serverName : "";
}

function mcpServerPath(name: string): `/${string}` {
  return `/mcp-servers/${encodeURIComponent(name)}`;
}
