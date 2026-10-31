import { z } from "zod";
import { webEventSchema } from "./events.js";

/** A local command the session starts (stdio), or a remote URL (Streamable HTTP). */
export const mcpServerTransportSchema = z.enum(["stdio", "streamable-http"]);
export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;

const stdioConnectionSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string(),
  arguments: z.array(z.string()),
});

const streamableHttpConnectionSchema = z.object({
  transport: z.literal("streamable-http"),
  url: z.string(),
});

/**
 * A Server value: an environment variable of a local server, a header of a remote one. A plain
 * value's Office-wide value is sent back; a secret's never is, only whether it is set.
 */
export const serverValueSchema = z.object({
  name: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  /** Absent for a secret and for a value not set. */
  officeWideValue: z.string().optional(),
  officeWideValueSet: z.boolean(),
});
export type ServerValue = z.infer<typeof serverValueSchema>;

/** Off until the user reviews it, and again after a change to what runs or to its values' names. */
export const mcpServerStateSchema = z.enum(["on", "off"]);
export type McpServerState = z.infer<typeof mcpServerStateSchema>;

const mcpServerFieldsSchema = z.object({
  /** Its tools are named `mcp__<name>__<tool>`, so it is never changed. */
  name: z.string().min(1),
  serverValues: z.array(serverValueSchema),
  state: mcpServerStateSchema,
  addedAt: z.iso.datetime(),
});

/** GET /mcp-servers/:name, and each of GET /mcp-servers. */
export const mcpServerSchema = z.discriminatedUnion("transport", [
  mcpServerFieldsSchema.extend(stdioConnectionSchema.shape),
  mcpServerFieldsSchema.extend(streamableHttpConnectionSchema.shape),
]);
export type McpServer = z.infer<typeof mcpServerSchema>;

export const mcpServerListSchema = z.array(mcpServerSchema);

/**
 * A Server value as the form saves it. Without an `officeWideValue` it keeps the one kept under
 * its name (but not a secret's once it is no longer secret); an empty one clears it.
 */
export const serverValueEditSchema = z.object({
  name: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  officeWideValue: z.string().optional(),
});
export type ServerValueEdit = z.infer<typeof serverValueEditSchema>;

const serverValueEditsSchema = z.object({ serverValues: z.array(serverValueEditSchema) });

/** PUT /mcp-servers/:name: its command or URL and its Server values; the name stays. */
export const mcpServerEditSchema = z.discriminatedUnion("transport", [
  serverValueEditsSchema.extend(stdioConnectionSchema.shape),
  serverValueEditsSchema.extend(streamableHttpConnectionSchema.shape),
]);
export type McpServerEdit = z.infer<typeof mcpServerEditSchema>;

const newMcpServerFieldsSchema = serverValueEditsSchema.extend({ name: z.string() });

/**
 * POST /mcp-servers, which adds it off. Also what POST /mcp-servers/pasted-config answers, for the
 * form to show: its values as pasted, its name empty when the config gave none.
 */
export const newMcpServerSchema = z.discriminatedUnion("transport", [
  newMcpServerFieldsSchema.extend(stdioConnectionSchema.shape),
  newMcpServerFieldsSchema.extend(streamableHttpConnectionSchema.shape),
]);
export type NewMcpServer = z.infer<typeof newMcpServerSchema>;

/** POST /mcp-servers/pasted-config: one server in the shape of Claude Code's `mcpServers`. */
export const pastedConfigSchema = z.object({ config: z.string() });
export type PastedConfig = z.infer<typeof pastedConfigSchema>;

export const mcpServerRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type McpServerRefusal = z.infer<typeof mcpServerRefusalSchema>;

/** Every library event reaches the web, naming the server, so an open page refetches it. */
export const mcpServerWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("mcp-server.added"), serverName: z.string() }),
  webEventSchema.extend({ type: z.literal("mcp-server.changed"), serverName: z.string() }),
  webEventSchema.extend({ type: z.literal("mcp-server.removed"), serverName: z.string() }),
]);
export type McpServerWebEvent = z.infer<typeof mcpServerWebEventSchema>;
