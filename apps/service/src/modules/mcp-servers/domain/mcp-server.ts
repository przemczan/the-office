export const MCP_SERVER_TRANSPORTS = ["stdio", "streamable-http"] as const;
export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number];

/** How a session reaches the server: a local command it starts, or a remote URL. */
export type McpServerConnection =
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly arguments: readonly string[];
    }
  | { readonly transport: "streamable-http"; readonly url: string };

/**
 * A value the server needs (spec §5.4): an environment variable of a local server, a header of a
 * remote one. A Project's page may override its Office-wide value.
 */
export interface ServerValue {
  readonly name: string;
  /** Kept in the database and never sent back. */
  readonly secret: boolean;
  /** A session whose Project has no value for it leaves the server out. */
  readonly required: boolean;
  /** Undefined until the user sets one. */
  readonly officeWideValue?: string;
}

/** Off until the user reviews it, and again after a change that needs a new review. */
export const MCP_SERVER_STATES = ["on", "off"] as const;
export type McpServerState = (typeof MCP_SERVER_STATES)[number];

/** A tool as the server listed it at the review. */
export interface McpServerTool {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema of its input. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** A server in The Office's library, whose tools a Role card may give its Agents. */
export interface McpServer {
  /** Its tools are named `mcp__<name>__<tool>`, so it never changes. */
  readonly name: string;
  readonly connection: McpServerConnection;
  readonly serverValues: readonly ServerValue[];
  readonly state: McpServerState;
  /** The tools the review listed when it was turned on; none while it is off. */
  readonly tools: readonly McpServerTool[];
  readonly addedAt: Date;
}

/**
 * A Server value as the user saves it. Without an `officeWideValue` it keeps the one kept under
 * its name; an empty one clears it.
 */
export interface ServerValueEdit {
  readonly name: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly officeWideValue?: string;
}

/** A server's command or URL and its Server values, as the user saves them. */
export interface McpServerEdit {
  readonly connection: McpServerConnection;
  readonly serverValues: readonly ServerValueEdit[];
}

export interface NewMcpServer extends McpServerEdit {
  readonly name: string;
}

/** Room for the tool's own name in `mcp__<name>__<tool>`, which the model APIs cap at 64. */
export const NAME_LENGTH = 32;

/** The Engine's own tool server, whose tools are the Office tools. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["office"]);

/** Single hyphens only, so `__` in a tool's name always separates the server from the tool. */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** RFC 9110's token characters. */
const HEADER_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function mcpServerNameProblems(name: string): string[] {
  if (name === "") return ["An MCP server needs a name."];
  const problems: string[] = [];
  if (!NAME_PATTERN.test(name)) {
    problems.push(
      `"${name}" can't name an MCP server: use lowercase letters, digits and single hyphens, such as brave-search.`,
    );
  }
  if (name.length > NAME_LENGTH) {
    problems.push(`An MCP server's name is at most ${NAME_LENGTH} characters.`);
  }
  if (RESERVED_NAMES.has(name)) {
    problems.push(`"${name}" names The Office's own tools; pick another name.`);
  }
  return problems;
}

export function mcpServerNameTaken(name: string): string {
  return `The library already has an MCP server named "${name}".`;
}

export function connectionProblems(connection: McpServerConnection): string[] {
  if (connection.transport === "stdio") {
    return connection.command === "" ? ["A local MCP server needs a command."] : [];
  }
  return isHttpUrl(connection.url) ? [] : ["A remote MCP server needs an http or https URL."];
}

/** Every problem of the values' names, which depend on the transport they are sent by. */
export function serverValueProblems(
  transport: McpServerTransport,
  serverValues: readonly Pick<ServerValue, "name">[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { name } of serverValues) {
    if (name === "") {
      problems.push("Each Server value needs a name.");
      continue;
    }
    const problem = serverValueNameProblem(transport, name);
    if (problem) problems.push(problem);
    const key = sameNameKey(transport, name);
    if (seen.has(key)) problems.push(`The Server value "${name}" is declared twice.`);
    seen.add(key);
  }
  return problems;
}

/** A server's values are environment variables when it runs locally and headers when remote. */
function serverValueNameProblem(transport: McpServerTransport, name: string): string | undefined {
  if (transport === "stdio") {
    return ENVIRONMENT_VARIABLE_PATTERN.test(name)
      ? undefined
      : `"${name}" can't name an environment variable: use letters, digits and underscores, not starting with a digit.`;
  }
  return HEADER_PATTERN.test(name) ? undefined : `"${name}" can't name a header.`;
}

/** Header names are compared regardless of case, as HTTP does. */
function sameNameKey(transport: McpServerTransport, name: string): string {
  return transport === "streamable-http" ? name.toLowerCase() : name;
}

function isHttpUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === "http:" || protocol === "https:";
}

/** The connection with its text trimmed; arguments are kept as given, since spaces may matter. */
export function trimmedConnection(connection: McpServerConnection): McpServerConnection {
  return connection.transport === "stdio"
    ? { ...connection, command: connection.command.trim() }
    : { ...connection, url: connection.url.trim() };
}

/** The text with each secret's Office-wide value hidden, for a server's own words to be shown. */
export function withoutSecrets(text: string, server: McpServer): string {
  return server.serverValues.reduce(
    (hidden, { secret, officeWideValue }) =>
      secret && officeWideValue ? hidden.replaceAll(officeWideValue, "•••") : hidden,
    text,
  );
}

export function sameConnection(one: McpServerConnection, other: McpServerConnection): boolean {
  if (one.transport === "stdio" && other.transport === "stdio") {
    return (
      one.command === other.command &&
      one.arguments.length === other.arguments.length &&
      one.arguments.every((argument, index) => argument === other.arguments[index])
    );
  }
  if (one.transport === "streamable-http" && other.transport === "streamable-http") {
    return one.url === other.url;
  }
  return false;
}
