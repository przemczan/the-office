import type { McpServerConnection, NewMcpServer, ServerValueEdit } from "./mcp-server.js";
import { McpServerRefused } from "./mcp-server-refused.js";

type JsonObject = Readonly<Record<string, unknown>>;

/** What a pasted entry's values are read from, as Claude Code's `mcpServers` entries hold them. */
const VALUES_FIELD = { stdio: "env", "streamable-http": "headers" } as const;

/** Names that usually hold a token or a password, so their pasted values start as secrets. */
const SECRET_NAME = /key|token|secret|password|passw|auth|credential|cookie|session/i;

/** `${VAR}` or `${VAR:-default}`: Claude Code fills it from its environment, so it isn't a value. */
const VARIABLE_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-(.*))?\}$/s;

/**
 * Reads one server from a pasted JSON config, the shape of Claude Code's `mcpServers` entries:
 * `{"mcpServers": {"name": {...}}}`, `{"name": {...}}`, or the entry alone, whose name is then
 * empty for the user to give. Its values are required, and secret when their names look it; the
 * user checks them in the form before adding the server.
 */
export function pastedMcpServer(config: string): NewMcpServer {
  const [name, entry] = onlyEntry(jsonObject(config));
  if (!isJsonObject(entry)) refuse(`The entry "${name}" isn't a JSON object.`);
  const connection = connectionOf(entry);
  return {
    name,
    connection,
    serverValues: serverValuesOf(entry, VALUES_FIELD[connection.transport]),
  };
}

function jsonObject(config: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch {
    refuse("The pasted config isn't valid JSON.");
  }
  if (!isJsonObject(parsed)) refuse("The pasted config isn't a JSON object.");
  return parsed;
}

function onlyEntry(config: JsonObject): readonly [string, unknown] {
  if (isEntry(config)) return ["", config];
  const servers = config["mcpServers"] ?? config;
  if (!isJsonObject(servers)) refuse("The pasted config's mcpServers isn't a JSON object.");
  const entries = Object.entries(servers);
  if (entries.length === 0) refuse("The pasted config holds no MCP server.");
  if (entries.length > 1) {
    refuse(`The pasted config holds ${entries.length} MCP servers; paste one at a time.`);
  }
  return entries[0] as [string, unknown];
}

function isEntry(config: JsonObject): boolean {
  return "command" in config || "url" in config || "type" in config;
}

function connectionOf(entry: JsonObject): McpServerConnection {
  const type = entry["type"] ?? ("url" in entry ? "http" : "stdio");
  switch (type) {
    case "stdio":
      return {
        transport: "stdio",
        command: text(entry, "command"),
        arguments: texts(entry, "args"),
      };
    case "http":
    case "streamable-http":
      return { transport: "streamable-http", url: text(entry, "url") };
    case "sse":
      return refuse(
        "The Office doesn't run servers on the legacy SSE transport; use the server's Streamable HTTP URL.",
      );
    default:
      return refuse(
        `The Office doesn't run MCP servers of type ${JSON.stringify(type)}: only stdio and http.`,
      );
  }
}

function serverValuesOf(entry: JsonObject, field: string): ServerValueEdit[] {
  const values = entry[field] ?? {};
  if (!isJsonObject(values)) refuse(`The entry's ${field} isn't a JSON object.`);
  return Object.entries(values).map(([name, value]) => {
    if (typeof value !== "string") refuse(`The entry's ${field}.${name} isn't text.`);
    const officeWideValue = pastedValue(value);
    return {
      name,
      secret: SECRET_NAME.test(name),
      required: true,
      ...(officeWideValue !== undefined && { officeWideValue }),
    };
  });
}

/** The value itself, the default of a reference to a variable, or undefined for a bare reference. */
function pastedValue(value: string): string | undefined {
  const reference = VARIABLE_REFERENCE.exec(value);
  return reference ? reference[1] : value;
}

function text(entry: JsonObject, field: string): string {
  const value = entry[field];
  if (typeof value !== "string") refuse(`The entry needs its ${field} as text.`);
  return value;
}

function texts(entry: JsonObject, field: string): string[] {
  const value: unknown = entry[field] ?? [];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    refuse(`The entry's ${field} isn't a list of texts.`);
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(reason: string): never {
  throw new McpServerRefused([reason]);
}
