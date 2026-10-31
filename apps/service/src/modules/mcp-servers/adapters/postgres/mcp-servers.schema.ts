import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type {
  McpServerState,
  McpServerTool,
  McpServerTransport,
  ServerValue,
} from "../../domain/mcp-server.js";
import type { RecordedMcpServer } from "../../domain/session-mcp-servers.js";

/**
 * Each MCP server in the library: a local command with its arguments or a remote URL, and its
 * Server values with their Office-wide values, secrets among them, and the tools its review listed
 * when it was turned on.
 */
export const mcpServers = pgTable(
  "mcp_servers",
  {
    name: text("name").primaryKey(),
    transport: text("transport").$type<McpServerTransport>().notNull(),
    command: text("command"),
    arguments: jsonb("arguments").$type<readonly string[]>(),
    url: text("url"),
    serverValues: jsonb("server_values").$type<readonly ServerValue[]>().notNull(),
    state: text("state").$type<McpServerState>().notNull(),
    tools: jsonb("tools").$type<readonly McpServerTool[]>().notNull().default([]),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "mcp_servers_connection",
      sql`(${table.transport} = 'stdio' AND ${table.command} IS NOT NULL AND ${table.arguments} IS NOT NULL AND ${table.url} IS NULL) OR (${table.transport} = 'streamable-http' AND ${table.url} IS NOT NULL AND ${table.command} IS NULL AND ${table.arguments} IS NULL)`,
    ),
    check("mcp_servers_state", sql`${table.state} IN ('on', 'off')`),
  ],
);

/** Each server assigned to a Role, by the Role's key; a removed server takes its own along. */
export const roleMcpServers = pgTable(
  "role_mcp_servers",
  {
    roleKey: text("role_key").notNull(),
    serverName: text("server_name")
      .notNull()
      .references(() => mcpServers.name, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.serverName] })],
);

/**
 * A Project's own values for a server's Server values, secrets among them; a removed server takes
 * its own along.
 */
export const projectServerValues = pgTable(
  "project_server_values",
  {
    projectId: text("project_id").notNull(),
    serverName: text("server_name")
      .notNull()
      .references(() => mcpServers.name, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    secret: boolean("secret").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.serverName, table.name] })],
);

/** The servers each session started with, never their values, while it can be resumed. */
export const sessionMcpServers = pgTable("session_mcp_servers", {
  sessionId: text("session_id").primaryKey(),
  projectId: text("project_id"),
  servers: jsonb("servers").$type<readonly RecordedMcpServer[]>().notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
});
