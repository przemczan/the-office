import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";

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

/** A tool as the server lists it. */
export const mcpServerToolSchema = z.object({
  name: z.string(),
  /** Empty when the server gives none. */
  description: z.string(),
  /** The JSON Schema of its input. */
  inputSchema: z.record(z.string(), z.unknown()),
});
export type McpServerTool = z.infer<typeof mcpServerToolSchema>;

const mcpServerFieldsSchema = z.object({
  /** Its tools are named `mcp__<name>__<tool>`, so it is never changed. */
  name: z.string().min(1),
  serverValues: z.array(serverValueSchema),
  state: mcpServerStateSchema,
  /** The tools its review listed when it was turned on; none while it is off. */
  tools: z.array(mcpServerToolSchema),
  /**
   * Of `tools`, those sessions leave out, by name: as `mcp__<server>__<tool>` their names run over
   * the model APIs' 64 characters.
   */
  toolsTooLong: z.array(z.string()),
  /** The keys of the Roles it is assigned to, in order. */
  roles: z.array(z.string()),
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

/**
 * GET /mcp-servers/:name/review: the server with the tools it lists on a test connection with its
 * Office-wide values, or why it couldn't connect (a secret's value hidden from the server's words).
 */
export const mcpServerReviewSchema = z.discriminatedUnion("connected", [
  z.object({
    server: mcpServerSchema,
    connected: z.literal(true),
    tools: z.array(mcpServerToolSchema),
    /**
     * The tools sessions leave out, by name: as `mcp__<server>__<tool>` their names run over the
     * model APIs' 64 characters.
     */
    toolsTooLong: z.array(z.string()),
    /** What the review showed, which turning the server on sends back. */
    reviewDigest: z.string(),
  }),
  z.object({ server: mcpServerSchema, connected: z.literal(false), problem: z.string() }),
]);
export type McpServerReview = z.infer<typeof mcpServerReviewSchema>;

/**
 * PUT /mcp-servers/:name/state. Turning it on carries the review's digest, and is refused when the
 * server or its tools changed since that review.
 */
export const mcpServerStateChangeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("on"), reviewDigest: z.string().min(1) }),
  z.object({ state: z.literal("off") }),
]);
export type McpServerStateChange = z.infer<typeof mcpServerStateChangeSchema>;

/** PUT /mcp-servers/:name/roles: exactly the Roles it is assigned to, by their keys. */
export const mcpServerRolesChangeSchema = z.object({ roles: z.array(z.string()) });
export type McpServerRolesChange = z.infer<typeof mcpServerRolesChangeSchema>;

const mcpServerNameInput = z
  .string()
  .min(1)
  .describe("The MCP server's name, as the library lists it; its tools are mcp__<name>__<tool>.");

/**
 * What runs, flat as an Office action's input is: a local command with its arguments (stdio), or a
 * remote URL (streamable-http). The one a transport needs is checked when the action is carried out.
 */
const mcpServerConnectionInput = {
  transport: mcpServerTransportSchema.describe(
    "stdio starts a local command; streamable-http connects to a remote URL.",
  ),
  command: z.string().optional().describe("For stdio: the command to start."),
  arguments: z.array(z.string()).optional().describe("For stdio: its arguments, one by one."),
  url: z.string().optional().describe("For streamable-http: the server's URL."),
  serverValues: z
    .array(serverValueEditSchema)
    .describe(
      "Its Server values: an environment variable of a local server, a header of a remote one. A secret's value is the user's to hold: it is never shown again, and a call that gives one is a Proposal the user applies.",
    ),
};

/** Office action: an MCP server added to the library, off until the user reviews it. */
export const ADD_MCP_SERVER_ACTION = officeAction({
  name: "add_mcp_server",
  title: "Add an MCP server",
  description:
    "Adds an MCP server to the library: its name, what runs it and its Server values. It arrives off until the user has reviewed what runs and the tools it lists. Refused when the name is taken or what runs is invalid.",
  input: z.object({
    name: z.string().describe("Its name: lowercase letters and digits."),
    ...mcpServerConnectionInput,
  }),
  answer: mcpServerSchema,
  route: { method: "POST", path: "/mcp-servers" },
  status: 201,
  area: "library",
  group: "mcpServers",
  subject: ({ name }) => ({ kind: "mcp-server", id: name.trim() }),
});

/** Office action: what an MCP server runs and its Server values changed. */
export const CHANGE_MCP_SERVER_ACTION = officeAction({
  name: "change_mcp_server",
  title: "Change an MCP server",
  description:
    "Changes what an MCP server runs and its Server values, whole; its name stays. It goes off until reviewed again when what runs or its values' names change.",
  input: z.object({ name: mcpServerNameInput, ...mcpServerConnectionInput }),
  answer: mcpServerSchema,
  route: { method: "PUT", path: "/mcp-servers/:name" },
  area: "library",
  group: "mcpServers",
  subject: ({ name }) => ({ kind: "mcp-server", id: name }),
});

/** Office action: an MCP server turned on against its review, or off. */
export const CHANGE_MCP_SERVER_STATE_ACTION = officeAction({
  name: "change_mcp_server_state",
  title: "Turn an MCP server on or off",
  description:
    "Turns an MCP server on or off. Turning it on connects to it with its Office-wide values, reviews the tools it lists and turns it on against that review; leave `reviewDigest` out, the Office reviews it itself. Refused when it can't connect, or when the server or its tools changed since a Proposal's draft.",
  input: z.object({
    name: mcpServerNameInput,
    state: mcpServerStateSchema,
    reviewDigest: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The digest of the review the user read, which the web sends when turning it on; Agents leave it out.",
      ),
  }),
  answer: mcpServerSchema,
  route: { method: "PUT", path: "/mcp-servers/:name/state" },
  area: "library",
  group: "mcpServers",
  subject: ({ name }) => ({ kind: "mcp-server", id: name }),
});

/** Office action: exactly the Roles an MCP server is assigned to. */
export const CHANGE_MCP_SERVER_ROLES_ACTION = officeAction({
  name: "change_mcp_server_roles",
  title: "Change the Roles of an MCP server",
  description:
    "Assigns an MCP server to exactly the Roles given, by key, replacing the Roles it had; their next sessions get its tools, each starting at Consult for the holder of Default Consultant for MCP tool hard switches.",
  input: mcpServerRolesChangeSchema.extend({ name: mcpServerNameInput }),
  answer: mcpServerSchema,
  route: { method: "PUT", path: "/mcp-servers/:name/roles" },
  area: "library",
  group: "mcpServers",
  subject: ({ name }) => ({ kind: "mcp-server", id: name }),
});

/** Office action: an MCP server removed from the library. */
export const REMOVE_MCP_SERVER_ACTION = officeAction({
  name: "remove_mcp_server",
  title: "Remove an MCP server",
  description:
    "Removes an MCP server from the library, with its Server values and Role assignments.",
  input: z.object({ name: mcpServerNameInput }),
  answer: z.void(),
  route: { method: "DELETE", path: "/mcp-servers/:name" },
  status: 204,
  area: "library",
  group: "mcpServers",
  subject: ({ name }) => ({ kind: "mcp-server", id: name }),
});

/** The Office actions the MCP server library carries out. */
export const MCP_SERVERS_OFFICE_ACTIONS = [
  ADD_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_STATE_ACTION,
  CHANGE_MCP_SERVER_ROLES_ACTION,
  REMOVE_MCP_SERVER_ACTION,
] as const;

/**
 * A Server value on a Project's page: its Office-wide value and the Project's own, which wins. A
 * secret's values are never sent back, only whether they are set.
 */
export const projectServerValueSchema = serverValueSchema.extend({
  /** Absent for a secret and for a value the Project doesn't set. */
  projectValue: z.string().optional(),
  projectValueSet: z.boolean(),
});
export type ProjectServerValue = z.infer<typeof projectServerValueSchema>;

/** One MCP server's Server values on a Project's page. */
export const projectMcpServerValuesSchema = z.object({
  serverName: z.string(),
  serverValues: z.array(projectServerValueSchema),
});
export type ProjectMcpServerValues = z.infer<typeof projectMcpServerValuesSchema>;

/** GET /projects/:id/server-values: each server of the library that has Server values. */
export const projectMcpServerValuesListSchema = z.array(projectMcpServerValuesSchema);

/**
 * A Project's value as the Project page saves it. Without a `projectValue` it keeps the one kept;
 * an empty one clears it, so the Office-wide value applies.
 */
export const projectServerValueEditSchema = z.object({
  name: z.string(),
  projectValue: z.string().optional(),
});
export type ProjectServerValueEdit = z.infer<typeof projectServerValueEditSchema>;

/**
 * PUT /projects/:id/server-values/:serverName: the Project's values for the server; a Server value
 * not given is cleared.
 */
export const projectServerValuesChangeSchema = z.object({
  serverValues: z.array(projectServerValueEditSchema),
});
export type ProjectServerValuesChange = z.infer<typeof projectServerValuesChangeSchema>;

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
  webEventSchema.extend({ type: z.literal("mcp-server.turned-on"), serverName: z.string() }),
  webEventSchema.extend({ type: z.literal("mcp-server.turned-off"), serverName: z.string() }),
  webEventSchema.extend({ type: z.literal("mcp-server.roles-changed"), serverName: z.string() }),
  webEventSchema.extend({ type: z.literal("mcp-server.removed"), serverName: z.string() }),
]);
export type McpServerWebEvent = z.infer<typeof mcpServerWebEventSchema>;
