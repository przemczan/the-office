import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  McpServerState,
  McpServerTool,
  McpServerTransport,
  ServerValue,
} from "../../domain/mcp-server.js";

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
